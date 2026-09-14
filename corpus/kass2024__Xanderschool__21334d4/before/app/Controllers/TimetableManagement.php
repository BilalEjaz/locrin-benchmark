<?php

namespace App\Controllers;

use App\Libraries\GeminiTimetable;
use App\Libraries\TimetableClassLabel;
use App\Libraries\TimetableTrack;
use App\Libraries\Wkhtmltopdf;
use App\Models\ClassesModel;
use App\Models\StaffModel;
use App\Models\TimetableSchemaModel;
use App\Services\Timetable\SecondaryTimetableCriteria;
use App\Services\Timetable\TimetableConflictService;
use App\Services\Timetable\TimetableCriteriaStore;
use App\Services\Timetable\TimetableGeneratorService;
use App\Services\Timetable\TimetableJobCancelledException;
use App\Services\Timetable\TimetableStagingService;
use App\Services\Timetable\TimetableUnplacedReport;

class TimetableManagement extends Home
{
	protected function bootTimetable(): array
	{
		$this->_preset();
		$schoolId = (int) $this->session->get('soma_school_id');
		$staffId = (int) $this->session->get('soma_id');
		$schema = new TimetableSchemaModel();
		$schema->ensureSchema();
		$schema->seedDefaultSlots($schoolId);
		return [$schoolId, $staffId, $schema];
	}

	protected function denyMenu(string $key): void
	{
		if (!function_exists('menu_clearance_allowed') || !menu_clearance_allowed($key)) {
			$this->session->setFlashdata('error', 'You do not have access to Timetable Management.');
			header('Location: ' . base_url('dashboard'));
			exit;
		}
	}

	public function dashboard()
	{
		$this->denyMenu('timetable_dashboard');
		list($schoolId, $staffId, $schema) = $this->bootTimetable();
		$db = \Config\Database::connect();
		$data = $this->data;
		$data['title'] = 'Timetable Management';
		$data['subtitle'] = 'Pedagogical Documents';
		$data['page'] = 'timetable_dashboard';

		$year = (int) ($data['academic_year'] ?? 0);
		$term = (int) ($data['term'] ?? 1);
		// Manual generate only — do not auto-queue when assignments changed.
		$data['active_generation_job'] = $this->findExistingTimetableJob($schoolId, $year, $term);
		$data['timetable_stale'] = $this->isTimetableStale($schoolId, $year, $term);

		$data['classes'] = $this->fetchClassRows($db, $schoolId);

		$data['schedule'] = $db->table('timetable_schedules')
			->where('school_id', $schoolId)
			->where('academic_year', $year)
			->where('term', $term)
			->orderBy('id', 'DESC')
			->get(1)->getRowArray();

		$data['staffs'] = $this->fetchTimetableStaffRows(
			$db,
			$schoolId,
			$year,
			$term,
			(int) ($data['schedule']['id'] ?? 0)
		);
		$data['generation_levels'] = $this->buildGenerationLevelCards($schoolId, $year, $term, $schema, $data['schedule'] ?? null);
		$data['last_generation_job'] = $this->findLastFinishedTimetableJob($schoolId, $year, $term);
		$criteriaStore = new TimetableCriteriaStore();
		$data['custom_criteria'] = $criteriaStore->listForSchool($schoolId);
		$data['criteria_courses'] = $this->uniqueAssignmentCourses($this->loadAssignments($schoolId, $year, $term));

		$data['staff_with_timetable'] = 0;
		if (!empty($data['schedule'])) {
			$data['staff_with_timetable'] = (int) $db->table('timetable_entries')
				->where('schedule_id', (int) $data['schedule']['id'])
				->select('COUNT(DISTINCT staff_id) AS c', false)
				->get(1)->getRow()->c;
		}

		$data['assignment_count'] = $this->countAssignments($schoolId, $year, $term);
		$data['test_assignment_count'] = $this->countTestAssignments($schoolId, $year);
		$data['slots'] = $schema->allSlots($schoolId);
		$data['settings_url'] = base_url('settings#timetable-settings');
		$data['special_times'] = $schema->specialTimes($schoolId);
		$settings = $db->table('timetable_settings')->where('school_id', $schoolId)->get(1)->getRowArray();
		$data['day_labels'] = TimetableSchemaModel::dayLabelsForTrack($settings, TimetableTrack::ALL);
		$data['criteria_day_choices'] = TimetableSchemaModel::criteriaDayChoices();
		$data['class_count'] = count($data['classes']);
		$data['staff_count'] = count($data['staffs']);
		$data['period_count'] = count(array_filter($data['slots'], static function ($s) {
			return empty($s['is_break']);
		}));
		$data['special_count'] = count($data['special_times']);
		$data['entry_count'] = 0;
		if (!empty($data['schedule'])) {
			$data['entry_count'] = (int) $db->table('timetable_entries')
				->where('schedule_id', (int) $data['schedule']['id'])
				->where('day_of_week >=', 0)
				->where('slot_id >', 0)
				->countAllResults();
		}
		$previewMode = $this->request->getGet('preview_mode') === 'teacher' ? 'teacher' : 'class';
		$previewId = (int) $this->request->getGet('preview_id');
		$data['preview_mode'] = $previewMode;
		$data['preview_class_id'] = !empty($data['classes']) ? (int) $data['classes'][0]['id'] : 0;
		$data['preview_teacher_id'] = !empty($data['staffs']) ? (int) $data['staffs'][0]['id'] : 0;
		if ($previewMode === 'class' && $previewId > 0) {
			$data['preview_class_id'] = $previewId;
		}
		if ($previewMode === 'teacher' && $previewId > 0) {
			$data['preview_teacher_id'] = $previewId;
		}
		$previewEntityId = $previewMode === 'teacher'
			? (int) $data['preview_teacher_id']
			: (int) $data['preview_class_id'];
		$data['preview_data'] = null;
		if ($previewEntityId > 0 && !empty($data['schedule'])) {
			try {
				$data['preview_data'] = $this->gridBodyViewData(
					$this->buildGridView($schoolId, $schema, $previewMode, $previewEntityId, false, false)
				);
			} catch (\Throwable $e) {
				log_message('error', 'Timetable dashboard preview failed: {msg}', ['msg' => $e->getMessage()]);
				$data['preview_data'] = null;
			}
		}

		$data['content'] = view('pages/timetable/dashboard', $data);
		return view('main', $data);
	}

	public function save_slots()
	{
		$this->_preset(1, 3);
		list($schoolId) = $this->bootTimetable();
		$db = \Config\Database::connect();

		$labels = $this->request->getPost('slot_label') ?? [];
		$starts = $this->request->getPost('slot_start') ?? [];
		$ends = $this->request->getPost('slot_end') ?? [];
		$breaks = $this->request->getPost('slot_is_break') ?? [];
		$breakLabels = $this->request->getPost('slot_break_label') ?? [];
		$slotIds = $this->request->getPost('slot_id') ?? [];

		$trackKey = TimetableTrack::normalize($this->request->getPost('track_key') ?: TimetableTrack::ALL);
		$sharedMode = (bool) $this->request->getPost('shared_timetable');
		if ($this->request->getPost('shared_timetable') !== null) {
			$row = $db->table('timetable_settings')->where('school_id', $schoolId)->get(1)->getRowArray();
			$payload = ['shared_timetable' => $sharedMode ? 1 : 0, 'updated_at' => date('Y-m-d H:i:s')];
			if ($row) {
				$db->table('timetable_settings')->where('school_id', $schoolId)->update($payload);
			} else {
				$payload['school_id'] = $schoolId;
				$payload['days_json'] = json_encode(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
				$payload['include_sunday'] = 0;
				$payload['include_saturday'] = 0;
				$db->table('timetable_settings')->insert($payload);
			}
			if ($sharedMode) {
				$trackKey = TimetableTrack::ALL;
			}
		}

		$existing = $db->table('timetable_slots')
			->where('school_id', $schoolId)
			->where('track_key', $trackKey)
			->orderBy('sort_order', 'ASC')
			->get()->getResultArray();
		$existingById = [];
		foreach ($existing as $row) {
			$existingById[(int) $row['id']] = $row;
		}

		$keptIds = [];
		$order = 0;
		foreach ($labels as $i => $label) {
			$label = trim((string) $label);
			if ($label === '') {
				$label = (string) ($order + 1);
			}
			$payload = [
				'school_id' => $schoolId,
				'track_key' => $trackKey,
				'level_id' => 0,
				'sort_order' => $order++,
				'label' => $label,
				'start_time' => ($starts[$i] ?? '08:00') . (strlen((string) ($starts[$i] ?? '')) === 5 ? ':00' : ''),
				'end_time' => ($ends[$i] ?? '08:40') . (strlen((string) ($ends[$i] ?? '')) === 5 ? ':00' : ''),
				'is_break' => !empty($breaks[$i]) ? 1 : 0,
				'break_label' => trim((string) ($breakLabels[$i] ?? '')) ?: null,
			];

			$postedId = (int) ($slotIds[$i] ?? 0);
			if ($postedId > 0 && isset($existingById[$postedId])) {
				$db->table('timetable_slots')->where('id', $postedId)->update($payload);
				$keptIds[] = $postedId;
			} else {
				$db->table('timetable_slots')->insert($payload);
				$keptIds[] = (int) $db->insertID();
			}
		}

		if ($keptIds !== []) {
			$db->table('timetable_slots')
				->where('school_id', $schoolId)
				->where('track_key', $trackKey)
				->whereNotIn('id', $keptIds)
				->delete();
		} else {
			$db->table('timetable_slots')->where('school_id', $schoolId)->where('track_key', $trackKey)->delete();
		}

		$labels = TimetableTrack::labels();
		$trackLabel = $labels[$trackKey] ?? $trackKey;

		$includeSaturday = $this->request->getPost('include_saturday') ? 1 : 0;
		$row = $db->table('timetable_settings')->where('school_id', $schoolId)->get(1)->getRowArray();
		$includeSunday = !empty($row['include_sunday']) ? 1 : 0;
		if (!in_array($trackKey, [TimetableTrack::PRIMARY, TimetableTrack::NURSERY], true)) {
			$includeSunday = 1;
		}
		$dayList = TimetableSchemaModel::dayLabelsFromSettings([
			'include_saturday' => $includeSaturday,
			'include_sunday' => $includeSunday,
		]);
		$settingsPayload = [
			'days_json' => json_encode($dayList),
			'include_saturday' => $includeSaturday,
			'include_sunday' => $includeSunday,
			'updated_at' => date('Y-m-d H:i:s'),
		];
		if ($this->request->getPost('shared_timetable') !== null) {
			$settingsPayload['shared_timetable'] = $sharedMode ? 1 : 0;
		}
		if ($row) {
			$db->table('timetable_settings')->where('school_id', $schoolId)->update($settingsPayload);
		} else {
			$settingsPayload['school_id'] = $schoolId;
			$settingsPayload['shared_timetable'] = $sharedMode ? 1 : 0;
			$db->table('timetable_settings')->insert($settingsPayload);
		}

		if (in_array($trackKey, [TimetableTrack::PRIMARY, TimetableTrack::NURSERY], true)) {
			(new TimetableSchemaModel())->stripSundaySpecials($schoolId, $trackKey);
		}

		return $this->response->setJSON(['success' => 'Periods saved for ' . $trackLabel . '.']);
	}

	public function save_special_times()
	{
		$this->_preset(1, 3);
		list($schoolId) = $this->bootTimetable();
		$db = \Config\Database::connect();

		$days = $this->request->getPost('special_day') ?? [];
		$slots = $this->request->getPost('special_slot') ?? [];
		$labels = $this->request->getPost('special_label') ?? [];
		$colors = $this->request->getPost('special_color') ?? [];

		$trackKey = TimetableTrack::normalize($this->request->getPost('track_key') ?: TimetableTrack::ALL);

		$db->table('timetable_special_times')->where('school_id', $schoolId)->where('track_key', $trackKey)->delete();
		$order = 0;
		foreach ($labels as $i => $label) {
			$label = trim((string) $label);
			if ($label === '') {
				continue;
			}
			$day = (int) ($days[$i] ?? -1);
			$slotId = (int) ($slots[$i] ?? 0);
			if ($slotId <= 0 || $day < 0) {
				continue;
			}
			$color = trim((string) ($colors[$i] ?? 'yellow'));
			if (!in_array($color, ['yellow', 'blue', 'green', 'orange', 'purple', 'gray'], true)) {
				$color = 'yellow';
			}
			$db->table('timetable_special_times')->insert([
				'school_id' => $schoolId,
				'track_key' => $trackKey,
				'level_id' => 0,
				'day_of_week' => $day,
				'slot_id' => $slotId,
				'label' => $label,
				'color' => $color,
				'sort_order' => $order++,
			]);
		}

		return $this->response->setJSON(['success' => 'Special times saved (Chapel, Sabbath, etc.).']);
	}

	public function preview_grid($classId = 0)
	{
		$this->denyMenu('timetable_dashboard');
		list($schoolId, , $schema) = $this->bootTimetable();
		$db = \Config\Database::connect();
		$mode = $this->request->getGet('mode') === 'teacher' ? 'teacher' : 'class';
		$entityId = (int) $classId;

		if ($entityId <= 0) {
			return $this->response->setJSON(['error' => 'Select a class or teacher to preview.']);
		}
		if ($mode === 'teacher') {
			$staff = $db->table('staffs')->where('id', $entityId)->where('school_id', $schoolId)->get(1)->getRowArray();
			if (!$staff) {
				return $this->response->setJSON(['error' => 'Invalid teacher selected. Please choose a staff member from the Teacher list.']);
			}
		} else {
			$class = $db->table('classes')->where('id', $entityId)->where('school_id', $schoolId)->get(1)->getRowArray();
			if (!$class) {
				return $this->response->setJSON(['error' => 'Invalid class selected.']);
			}
		}

		try {
			@ini_set('memory_limit', '512M');
			@set_time_limit(120);
			$data = $this->buildGridView($schoolId, $schema, $mode, $entityId, false, false);
			$html = view('pages/timetable/_grid_body', $this->gridBodyViewData($data, false));
			$payload = [
				'title' => $data['title'] ?? 'Timetable',
				'html' => $html,
				'editable' => false,
			];
			$flags = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;
			if (defined('JSON_INVALID_UTF8_SUBSTITUTE')) {
				$flags |= JSON_INVALID_UTF8_SUBSTITUTE;
			}
			$json = json_encode($payload, $flags);
			if ($json === false) {
				return $this->response->setJSON(['error' => 'Could not encode timetable preview.']);
			}
			return $this->response
				->setHeader('Content-Type', 'application/json; charset=UTF-8')
				->setBody($json);
		} catch (\Throwable $e) {
			log_message('error', 'Timetable preview failed [{mode}:{id}]: {msg}', [
				'mode' => $mode,
				'id' => $entityId,
				'msg' => $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine(),
			]);
			return $this->response->setJSON([
				'error' => 'Could not build timetable preview: ' . $e->getMessage(),
			]);
		}
	}

	public function check_move()
	{
		$this->denyMenu('timetable_dashboard');
		list($schoolId, , $schema) = $this->bootTimetable();
		$entryId = (int) $this->request->getPost('entry_id');
		$day = (int) $this->request->getPost('day');
		$slotId = (int) $this->request->getPost('slot_id');
		$scheduleId = (int) $this->request->getPost('schedule_id');
		if ($entryId <= 0 || $scheduleId <= 0) {
			return $this->response->setJSON(['error' => 'Invalid request.']);
		}
		$checker = new TimetableConflictService();
		$conflicts = $checker->checkMove($scheduleId, $schoolId, $entryId, $day, $slotId, $schema);
		return $this->response->setJSON([
			'ok' => $conflicts === [],
			'conflicts' => $conflicts,
		]);
	}

	public function move_entry()
	{
		$this->denyMenu('timetable_dashboard');
		list($schoolId, , $schema) = $this->bootTimetable();
		$db = \Config\Database::connect();
		$entryId = (int) $this->request->getPost('entry_id');
		$day = (int) $this->request->getPost('day');
		$slotId = (int) $this->request->getPost('slot_id');
		$scheduleId = (int) $this->request->getPost('schedule_id');
		$force = (bool) $this->request->getPost('force');

		if ($entryId <= 0 || $scheduleId <= 0) {
			return $this->response->setJSON(['error' => 'Invalid lesson.']);
		}

		$entry = $db->table('timetable_entries')->where('id', $entryId)
			->where('schedule_id', $scheduleId)->where('school_id', $schoolId)->get(1)->getRowArray();
		if (!$entry) {
			return $this->response->setJSON(['error' => 'Lesson not found.']);
		}

		if ($day < 0 || $slotId <= 0) {
			$park = [
				'day_of_week' => -1,
				'slot_id' => 0,
			];
			if ($db->fieldExists('is_locked', 'timetable_entries')) {
				$park['is_locked'] = 0;
			}
			$db->table('timetable_entries')->where('id', $entryId)->update($park);
			return $this->response->setJSON(['success' => 'Lesson moved to holding area.']);
		}

		$checker = new TimetableConflictService();
		$conflicts = $checker->checkMove($scheduleId, $schoolId, $entryId, $day, $slotId, $schema);
		if ($conflicts !== [] && !$force) {
			return $this->response->setJSON(['error' => 'Conflict detected.', 'conflicts' => $conflicts]);
		}

		$placed = [
			'day_of_week' => $day,
			'slot_id' => $slotId,
		];
		if ($db->fieldExists('is_locked', 'timetable_entries')) {
			$placed['is_locked'] = 1;
		}
		$db->table('timetable_entries')->where('id', $entryId)->update($placed);

		return $this->response->setJSON(['success' => 'Timetable updated.']);
	}

	public function save_criteria()
	{
		$this->denyMenu('timetable_dashboard');
		list($schoolId, , $schema) = $this->bootTimetable();
		$input = $this->request->getPost() ?: [];
		$reject = $this->rejectOverloadedTeacherCriteria($schoolId, $schema, $input);
		if ($reject !== null) {
			return $this->response->setJSON(['error' => $reject]);
		}
		$store = new TimetableCriteriaStore();
		$result = $store->save($schoolId, $input);
		return $this->response->setJSON($result);
	}

	/**
	 * Teacher-days / teacher-window rules cannot shrink a heavy load (e.g. 76 periods/week).
	 */
	private function rejectOverloadedTeacherCriteria(int $schoolId, TimetableSchemaModel $schema, array $input): ?string
	{
		$type = trim((string) ($input['rule_type'] ?? ''));
		if (!in_array($type, ['teacher_days', 'teacher_window'], true)) {
			return null;
		}
		$teacherId = (int) ($input['teacher_id'] ?? 0);
		if ($teacherId <= 0) {
			return null;
		}
		$days = $input['days'] ?? [];
		if (is_string($days)) {
			$days = array_filter(array_map('intval', explode(',', $days)));
		}
		if (!is_array($days)) {
			$days = [];
		}
		$days = array_values(array_unique(array_map('intval', $days)));
		$days = array_values(array_filter($days, static fn ($d): bool => (int) $d !== 6));
		if ($days === []) {
			return null;
		}
		$year = (int) ($this->data['academic_year'] ?? 0);
		$term = (int) ($this->data['term'] ?? 0);
		$load = (int) ((\App\Libraries\StaffTeachingLoad::countsByStaff($schoolId, $year, $term)[$teacherId]['periods'] ?? 0));
		if ($load <= 0) {
			return null;
		}
		$slots = $schema->teachingSlots($schoolId, \App\Libraries\TimetableTrack::O_LEVEL);
		if ($slots === []) {
			$slots = $schema->teachingSlots($schoolId, \App\Libraries\TimetableTrack::ALL);
		}
		$slotsPerDay = max(1, count($slots));
		$cap = count($days) * $slotsPerDay;
		if ($load <= $cap) {
			return null;
		}
		$staff = (new StaffModel())->select('fname,lname')->where('id', $teacherId)->get(1)->getRowArray();
		$name = trim(($staff['fname'] ?? '') . ' ' . ($staff['lname'] ?? ''));
		if ($name === '') {
			$name = 'This teacher';
		}

		return $name . ' has ' . $load . ' weekly periods. This special criterion only leaves room for about '
			. $cap . ' periods, so it was rejected. Use the full week so empty periods can be filled.';
	}

	public function delete_criteria()
	{
		$this->denyMenu('timetable_dashboard');
		list($schoolId) = $this->bootTimetable();
		$id = (int) $this->request->getPost('id');
		$ok = (new TimetableCriteriaStore())->delete($schoolId, $id);
		return $this->response->setJSON($ok ? ['success' => true] : ['error' => 'Could not delete rule.']);
	}

	public function generate()
	{
		$this->denyMenu('timetable_dashboard');
		list($schoolId, $staffId, $schema) = $this->bootTimetable();
		$year = (int) ($this->request->getPost('academic_year') ?: $this->data['academic_year']);
		$term = (int) ($this->request->getPost('term') ?: $this->data['term']);
		$useGemini = (int) $this->request->getPost('use_gemini') === 1;
		$replaceLocked = (int) $this->request->getPost('replace_locked') === 1;
		$phase = TimetableTrack::normalizeGenerationPhase($this->request->getPost('phase'));
		if ($this->countAssignments($schoolId, $year, $term) <= 0) {
			return $this->response->setJSON(['error' => 'No course assignments found. Assign courses to classes first.']);
		}
		if ($phase !== 'all' && $this->countPhaseAssignments($schoolId, $year, $term, $phase, $schema) <= 0) {
			return $this->response->setJSON([
				'error' => 'No course assignments found for ' . TimetableTrack::generationPhaseLabel($phase) . '.',
			]);
		}
		// Release session lock so status polling is not blocked while the worker runs.
		if (session_status() === PHP_SESSION_ACTIVE) {
			@session_write_close();
		}
		if ($this->request->getPost('force') || $this->request->getPost('discard')) {
			$this->discardActiveTimetableJobs($schoolId, $year, $term);
		}
		$result = $this->queueBackgroundGeneration($schoolId, $staffId, $year, $term, 'manual', $useGemini, $phase, $replaceLocked);
		if (!empty($result['error']) && empty($result['queued']) && empty($result['job_id'])) {
			return $this->response->setJSON(['error' => $result['error']]);
		}
		return $this->response->setJSON($result);
	}

	/**
	 * Queue (or reuse) a background timetable regeneration for a school/year/term.
	 *
	 * @return array<string,mixed>
	 */
	public function queueBackgroundGeneration(
		int $schoolId,
		int $staffId,
		int $year,
		int $term,
		string $reason = 'manual',
		bool $useGemini = false,
		string $phase = 'all',
		bool $replaceLocked = false
	): array {
		if ($schoolId <= 0 || $year <= 0 || $term <= 0) {
			return ['error' => 'Invalid school/year/term for timetable regeneration.'];
		}
		$phase = TimetableTrack::normalizeGenerationPhase($phase);
		(new TimetableSchemaModel())->ensureSchema();
		$this->markTimetableDirty($schoolId, $year, $term);

		if ($this->countAssignments($schoolId, $year, $term) <= 0) {
			return ['error' => 'No course assignments found. Assign courses to classes first.'];
		}

		$existing = $this->findExistingTimetableJob($schoolId, $year, $term);
		if (is_array($existing) && $this->timetableJobLooksStale($existing)) {
			$this->cancelTimetableJob((string) $existing['id'], 'Previous generation stalled and was discarded.');
			$existing = null;
		}
		if (is_array($existing) && in_array((string) ($existing['status'] ?? ''), ['queued', 'running'], true)) {
			$this->spawnTimetableWorker((string) $existing['id']);
			return [
				'queued' => true,
				'job_id' => $existing['id'],
				'status' => $existing['status'],
				'message' => $existing['message'] ?? 'Timetable generation is already running.',
				'progress' => max(1, (int) ($existing['progress'] ?? 0)),
				'phase' => $existing['phase'] ?? 'all',
				'stages' => $existing['stages'] ?? [],
				'reason' => $reason,
			];
		}

		$phaseLabel = TimetableTrack::generationPhaseLabel($phase);
		$jobId = $this->createTimetableJob([
			'school_id' => $schoolId,
			'staff_id' => $staffId > 0 ? $staffId : 0,
			'academic_year' => $year,
			'term' => $term,
			'use_gemini' => $useGemini ? 1 : 0,
			'replace_locked' => $replaceLocked ? 1 : 0,
			'phase' => $phase,
			'reason' => $reason,
			'message' => 'Queued — ' . $phaseLabel . '…',
			'progress' => 3,
			'stage' => 'queued',
			'stages' => [],
			'last_spawn_at' => date('Y-m-d H:i:s'),
		]);
		$this->spawnTimetableWorker($jobId);

		return [
			'queued' => true,
			'job_id' => $jobId,
			'status' => 'queued',
			'message' => 'Starting ' . $phaseLabel . '…',
			'progress' => 3,
			'phase' => $phase,
			'reason' => $reason,
		];
	}

	public function markTimetableDirty(int $schoolId, int $year, int $term): void
	{
		if ($schoolId <= 0 || $year <= 0 || $term <= 0) {
			return;
		}
		try {
			$db = \Config\Database::connect();
			(new TimetableSchemaModel())->ensureSchema();
			$existing = $db->table('timetable_schedules')
				->where('school_id', $schoolId)
				->where('academic_year', $year)
				->where('term', $term)
				->orderBy('id', 'DESC')
				->get(1)->getRowArray();
			if ($existing) {
				$db->table('timetable_schedules')->where('id', (int) $existing['id'])->update([
					'needs_regen' => 1,
				]);
			}
		} catch (\Throwable $e) {
			log_message('error', 'markTimetableDirty failed: {msg}', ['msg' => $e->getMessage()]);
		}
	}

	public function assignmentsFingerprint(int $schoolId, int $year, int $term): string
	{
		$db = \Config\Database::connect();
		$rows = $db->table('course_records cr')
			->select('cr.id, cr.course, cr.class, cr.lecturer, cr.term, COALESCE(c.credit,0) AS credit')
			->join('courses c', 'c.id = cr.course', 'left')
			->join('classes cl', 'cl.id = cr.class')
			->where('cl.school_id', $schoolId)
			->where('cr.year', $year)
			->where("find_in_set($term, cr.term) > 0", null, false)
			->orderBy('cr.id', 'ASC')
			->get()->getResultArray();
		$parts = [];
		foreach ($rows as $row) {
			$parts[] = implode(':', [
				(int) ($row['id'] ?? 0),
				(int) ($row['course'] ?? 0),
				(int) ($row['class'] ?? 0),
				(int) ($row['lecturer'] ?? 0),
				trim((string) ($row['term'] ?? '')),
				(string) ($row['credit'] ?? '0'),
			]);
		}
		return hash('sha256', implode('|', $parts));
	}

	public function isTimetableStale(int $schoolId, int $year, int $term): bool
	{
		if ($schoolId <= 0 || $year <= 0 || $term <= 0) {
			return false;
		}
		if ($this->countAssignments($schoolId, $year, $term) <= 0) {
			return false;
		}
		$db = \Config\Database::connect();
		$schedule = $db->table('timetable_schedules')
			->where('school_id', $schoolId)
			->where('academic_year', $year)
			->where('term', $term)
			->orderBy('id', 'DESC')
			->get(1)->getRowArray();
		if (!$schedule) {
			return true;
		}
		if (!empty($schedule['needs_regen'])) {
			return true;
		}
		$current = $this->assignmentsFingerprint($schoolId, $year, $term);
		$stored = trim((string) ($schedule['assignments_hash'] ?? ''));
		return $stored === '' || !hash_equals($stored, $current);
	}

	/**
	 * Auto-regen cron is disabled — use Timetable → Generate smart timetable.
	 *
	 * @return array{queued:int,skipped:int,disabled:bool,schools:list<array<string,mixed>>}
	 */
	public function autoRegenerateStaleSchools(?int $onlySchoolId = null): array
	{
		return [
			'queued' => 0,
			'skipped' => 0,
			'disabled' => true,
			'message' => 'Automatic timetable regeneration is disabled. Generate from the Timetable dashboard.',
			'schools' => [],
		];
	}

	/** Re-spawn jobs left in queued state (worker spawn may have failed). */
	private function respawnOrphanQueuedJobs(): void
	{
		foreach (glob($this->timetableJobDir() . DIRECTORY_SEPARATOR . '*.json') ?: [] as $file) {
			$data = json_decode((string) @file_get_contents($file), true);
			if (!is_array($data) || (string) ($data['status'] ?? '') !== 'queued') {
				continue;
			}
			$created = strtotime((string) ($data['created_at'] ?? '')) ?: 0;
			if ($created > 0 && (time() - $created) < 45) {
				continue;
			}
			$jobId = (string) ($data['id'] ?? '');
			if ($jobId === '') {
				continue;
			}
			$this->spawnTimetableWorker($jobId);
		}
	}

	/**
	 * Process queued/running-stuck timetable jobs in-process (cron-safe in Docker).
	 *
	 * @return array{processed:int,failed:int,busy:int,jobs:list<array<string,mixed>>}
	 */
	public function processQueuedTimetableJobs(int $limit = 5): array
	{
		$limit = max(1, min(20, $limit));
		$jobs = [];
		foreach (glob($this->timetableJobDir() . DIRECTORY_SEPARATOR . '*.json') ?: [] as $file) {
			$data = json_decode((string) @file_get_contents($file), true);
			if (!is_array($data)) {
				continue;
			}
			$status = (string) ($data['status'] ?? '');
			if (!in_array($status, ['queued', 'running'], true)) {
				continue;
			}
			// Skip very fresh running jobs that may still be actively working.
			if ($status === 'running') {
				$started = strtotime((string) ($data['started_at'] ?? '')) ?: 0;
				$lock = $this->timetableJobPath((string) ($data['id'] ?? '')) . '.lock';
				$hasLock = is_file($lock);
				if ($started > 0 && (time() - $started) < 180 && $hasLock) {
					continue;
				}
				// Stale "running" with no lock — reclaim for processing.
				if (!$hasLock) {
					$data['status'] = 'queued';
					$this->updateTimetableJob((string) $data['id'], [
						'status' => 'queued',
						'message' => 'Requeued after stalled worker.',
						'started_at' => null,
					]);
				}
			}
			$jobs[] = $data;
		}
		usort($jobs, static function ($a, $b) {
			return strcmp((string) ($a['created_at'] ?? ''), (string) ($b['created_at'] ?? ''));
		});

		// One job per school/year/term — avoid racing regenerations.
		$unique = [];
		foreach ($jobs as $job) {
			$key = (int) ($job['school_id'] ?? 0) . ':' . (int) ($job['academic_year'] ?? 0) . ':' . (int) ($job['term'] ?? 0);
			if (isset($unique[$key])) {
				// Mark older duplicates done-skipped so they don't clog the queue.
				$dupId = (string) ($job['id'] ?? '');
				if ($dupId !== '') {
					$this->updateTimetableJob($dupId, [
						'status' => 'done',
						'success' => true,
						'message' => 'Skipped duplicate queue; newer/older sibling job covers this school.',
						'finished_at' => date('Y-m-d H:i:s'),
					]);
				}
				continue;
			}
			$unique[$key] = $job;
		}
		$jobs = array_values($unique);

		$processed = 0;
		$failed = 0;
		$busy = 0;
		$details = [];
		foreach (array_slice($jobs, 0, $limit) as $job) {
			$jobId = (string) ($job['id'] ?? '');
			if ($jobId === '') {
				continue;
			}
			$result = $this->processTimetableJobById($jobId);
			$details[] = [
				'job_id' => $jobId,
				'ok' => !empty($result['ok']),
				'status' => (string) (($this->readTimetableJob($jobId)['status'] ?? '')),
				'result' => $result,
			];
			if (!empty($result['busy'])) {
				$busy++;
			} elseif (!empty($result['ok'])) {
				$processed++;
			} else {
				$failed++;
			}
		}

		return [
			'processed' => $processed,
			'failed' => $failed,
			'busy' => $busy,
			'jobs' => $details,
		];
	}

	public function generation_status($jobId = '')
	{
		$this->_preset();
		$this->denyMenu('timetable_dashboard');
		$schoolId = (int) $this->session->get('soma_school_id');
		if (session_status() === PHP_SESSION_ACTIVE) {
			@session_write_close();
		}
		$job = $this->readTimetableJob((string) $jobId);
		if (!$job || (int) ($job['school_id'] ?? 0) !== $schoolId) {
			return $this->response->setStatusCode(404)->setJSON(['error' => 'Generation job not found.']);
		}
		$status = (string) ($job['status'] ?? '');
		if (in_array($status, ['queued', 'running'], true)) {
			if ($this->timetableJobLooksStale($job)) {
				$this->cancelTimetableJob((string) $jobId, 'Generation stalled. Discard it and generate again.');
				$fresh = $this->readTimetableJob((string) $jobId);
				return $this->response->setJSON(is_array($fresh) ? $fresh : $job);
			}
			$created = strtotime((string) ($job['created_at'] ?? '')) ?: time();
			$started = strtotime((string) ($job['started_at'] ?? '')) ?: 0;
			$lastSpawn = strtotime((string) ($job['last_spawn_at'] ?? '')) ?: 0;
			$lock = $this->timetableJobPath((string) $jobId) . '.lock';
			$hasLock = is_file($lock);
			$idleQueued = $status === 'queued' && (time() - $created) >= 3 && !$hasLock;
			$staleRunning = $status === 'running' && $started > 0 && (time() - $started) >= 180 && !$hasLock;
			$spawnCool = $lastSpawn <= 0 || (time() - $lastSpawn) >= 20;
			if (($idleQueued || $staleRunning) && $spawnCool) {
				$this->updateTimetableJob((string) $jobId, ['last_spawn_at' => date('Y-m-d H:i:s')]);
				$this->spawnTimetableWorker((string) $jobId);
			}
			$fresh = $this->readTimetableJob((string) $jobId);
			if (is_array($fresh)) {
				$job = $fresh;
			}
		}
		return $this->response->setJSON($job);
	}

	public function discard_generation()
	{
		$this->denyMenu('timetable_dashboard');
		list($schoolId) = $this->bootTimetable();
		$year = (int) ($this->request->getPost('academic_year') ?: $this->data['academic_year']);
		$term = (int) ($this->request->getPost('term') ?: $this->data['term']);
		$n = $this->discardActiveTimetableJobs($schoolId, $year, $term);
		return $this->response->setJSON([
			'success' => true,
			'discarded' => $n,
			'message' => $n > 0
				? 'Generation discarded. You can generate again.'
				: 'No running generation to discard.',
		]);
	}

	/**
	 * Background worker entry (no login). Protected by HMAC token.
	 */
	public function run_job($jobId = '')
	{
		@ignore_user_abort(true);
		@set_time_limit(0);
		if (session_status() === PHP_SESSION_ACTIVE) {
			@session_write_close();
		}
		$jobId = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) $jobId);
		$token = (string) ($this->request->getGet('token') ?? $this->request->getPost('token') ?? '');
		if ($jobId === '' || !hash_equals($this->timetableJobToken($jobId), $token)) {
			return $this->response->setStatusCode(403)->setBody('forbidden');
		}
		$result = $this->processTimetableJobById($jobId);
		return $this->response->setJSON($result);
	}

	private function timetableJobToken(string $jobId): string
	{
		$key = (string) (env('encryption.key') ?: env('app.baseURL') ?: 'xander-school-timetable');
		return hash_hmac('sha256', $jobId, $key);
	}

	/**
	 * @return array{entries:list<array<string,mixed>>,warnings:list<string>,schedule_id:int}|null
	 */
	private function runGeneration(int $schoolId, int $staffId, TimetableSchemaModel $schema, int $year, int $term, ?string $jobId = null, string $phase = 'all', bool $useGemini = false, bool $replaceLocked = false): ?array
	{
		try {
			return $this->runGenerationOnce($schoolId, $staffId, $schema, $year, $term, $jobId, $phase, $useGemini, $replaceLocked);
		} catch (TimetableJobCancelledException $e) {
			throw $e;
		} catch (\Throwable $e) {
			log_message('error', 'Timetable generation primary pass failed for school {school}, retrying after repair: {msg}', [
				'school' => $schoolId,
				'msg' => $e->getMessage(),
			]);
			$this->repairGenerationState($schoolId, $schema);
			if ($jobId) {
				$this->updateTimetableJob($jobId, [
					'message' => 'Retrying after repair…',
					'progress' => 8,
					'stage' => 'retry',
				]);
			}
			return $this->runGenerationOnce($schoolId, $staffId, $schema, $year, $term, $jobId, $phase, $useGemini, $replaceLocked);
		}
	}

	/**
	 * Smart generation by level phase (nursery / primary / secondary / all).
	 *
	 * @return array{entries:list<array<string,mixed>>,warnings:list<string>,schedule_id:int,staging_created:int,phase:string}|null
	 */
	private function runGenerationOnce(
		int $schoolId,
		int $staffId,
		TimetableSchemaModel $schema,
		int $year,
		int $term,
		?string $jobId = null,
		string $phase = 'all',
		bool $useGemini = false,
		bool $replaceLocked = false
	): ?array {
		$db = \Config\Database::connect();
		$phase = TimetableTrack::normalizeGenerationPhase($phase);
		$assignments = $this->loadAssignments($schoolId, $year, $term);
		if ($assignments === []) {
			return null;
		}

		$schema->ensureTrackSlots($schoolId, TimetableTrack::ALL);
		if (!$schema->isSharedSchedule($schoolId)) {
			foreach (TimetableTrack::tracksForSchool($schoolId) as $track) {
				$schema->ensureTrackSlots($schoolId, $track);
			}
		}

		$settings = $db->table('timetable_settings')->where('school_id', $schoolId)->get(1)->getRowArray();

		$byTrack = [];
		$byClassTrack = [];
		foreach ($assignments as $assignment) {
			$classId = (int) ($assignment['class_id'] ?? 0);
			$track = $schema->trackForClass($schoolId, $classId);
			$assignment['_track_key'] = $track;
			$byTrack[$track][] = $assignment;
			if ($classId > 0) {
				$byClassTrack[$classId] = $track;
			}
		}

		$orderedTracks = TimetableTrack::orderTracksForGeneration(array_keys($byTrack));
		/** @var array<string,list<string>> */
		$phaseTracks = [];
		foreach ($orderedTracks as $trackKey) {
			$phaseKey = TimetableTrack::generationPhaseKey($trackKey);
			$phaseTracks[$phaseKey][] = $trackKey;
		}
		if ($phase !== 'all') {
			$phaseTracks = array_intersect_key($phaseTracks, [$phase => true]);
		}
		if ($phaseTracks === []) {
			return null;
		}

		$phaseClassIds = [];
		$phaseAssignments = [];
		foreach ($phaseTracks as $tracks) {
			foreach ($tracks as $trackKey) {
				foreach ($byTrack[$trackKey] ?? [] as $row) {
					$cid = (int) ($row['class_id'] ?? 0);
					if ($cid > 0) {
						$phaseClassIds[$cid] = true;
					}
					$phaseAssignments[] = $row;
				}
			}
		}
		$classIdList = array_keys($phaseClassIds);

		$phaseKeys = array_keys($phaseTracks);
		$phaseCount = max(1, count($phaseKeys));
		$stages = [];
		foreach ($phaseKeys as $phaseKey) {
			$stages[] = [
				'key' => $phaseKey,
				'label' => TimetableTrack::generationPhaseLabel($phaseKey),
				'status' => 'pending',
			];
		}
		if ($useGemini) {
			$stages[] = ['key' => 'gemini', 'label' => 'AI collision check', 'status' => 'pending'];
		}
		$stages[] = ['key' => 'save', 'label' => 'Saving schedule', 'status' => 'pending'];

		$this->reportGenerationProgress($jobId, [
			'status' => 'running',
			'message' => 'Preparing ' . TimetableTrack::generationPhaseLabel($phase) . '…',
			'progress' => 5,
			'stage' => 'prepare',
			'stages' => $stages,
			'phase' => $phase,
		]);

		// Keep other levels' placements so teachers are not double-booked across phases.
		$existingSchedule = $db->table('timetable_schedules')
			->where('school_id', $schoolId)->where('academic_year', $year)->where('term', $term)
			->orderBy('id', 'DESC')->get(1)->getRowArray();
		$keepBusyEntries = [];
		$lockedEntries = [];
		$slotTimesById = [];
		if ($existingSchedule) {
			$scheduleIdExisting = (int) $existingSchedule['id'];
			if (!$replaceLocked) {
				$this->lockAllPlacedEntries($scheduleIdExisting, $phase === 'all' ? [] : $classIdList);
			}
			if ($phase !== 'all' && $classIdList !== []) {
				$keepBusyEntries = $db->table('timetable_entries te')
					->select('te.class_id, te.staff_id, te.course_id, te.day_of_week, te.slot_id, ts.start_time, ts.end_time')
					->join('timetable_slots ts', 'ts.id = te.slot_id', 'left')
					->where('te.schedule_id', $scheduleIdExisting)
					->where('te.entry_type', 'lesson')
					->where('te.day_of_week >=', 0)
					->where('te.slot_id >', 0)
					->whereNotIn('te.class_id', $classIdList)
					->get()->getResultArray();
			}
			if (!$replaceLocked && $db->fieldExists('is_locked', 'timetable_entries')) {
				$lockedQ = $db->table('timetable_entries te')
					->select('te.class_id, te.staff_id, te.course_id, te.day_of_week, te.slot_id, ts.start_time, ts.end_time')
					->join('timetable_slots ts', 'ts.id = te.slot_id', 'left')
					->where('te.schedule_id', $scheduleIdExisting)
					->where('te.entry_type', 'lesson')
					->where('te.is_locked', 1)
					->where('te.day_of_week >=', 0)
					->where('te.slot_id >', 0);
				if ($phase !== 'all' && $classIdList !== []) {
					$lockedQ->whereIn('te.class_id', $classIdList);
				}
				$lockedEntries = $lockedQ->get()->getResultArray();
			}
			$keepBusyEntries = array_merge($keepBusyEntries, $lockedEntries);
			foreach ($keepBusyEntries as $row) {
				$sid = (int) ($row['slot_id'] ?? 0);
				if ($sid > 0) {
					$slotTimesById[$sid] = [
						'start' => (string) ($row['start_time'] ?? '00:00:00'),
						'end' => (string) ($row['end_time'] ?? '00:00:00'),
					];
				}
			}
		}

		$allEntries = [];
		$allWarnings = [];
		$phaseIndex = 0;

		foreach ($phaseTracks as $phaseKey => $tracks) {
			if ($this->timetableJobWasDiscarded($jobId)) {
				throw new TimetableJobCancelledException('Generation discarded');
			}
			$phaseLabel = TimetableTrack::generationPhaseLabel($phaseKey);
			$stages = $this->markGenerationStage($stages, $phaseKey, 'running');
			$basePct = (int) round(8 + ($phaseIndex / $phaseCount) * 62);
			$this->reportGenerationProgress($jobId, [
				'message' => 'Generating ' . $phaseLabel . '…',
				'progress' => $basePct,
				'stage' => $phaseKey,
				'stages' => $stages,
			]);

			$generator = new TimetableGeneratorService();
			$generator->setAbortHandler(function () use ($jobId): bool {
				return $this->timetableJobWasDiscarded($jobId);
			});
			$generator->setCustomRules((new TimetableCriteriaStore())->listForSchool($schoolId, true));
			$allSlotTimes = $this->collectSlotTimesById($schoolId, $schema);
			$generator->mergeSlotTimes($allSlotTimes);
			$generator->setCombineSlotMaps($byClassTrack, $this->trackClockSlotMap($schoolId, $schema, array_keys($byTrack)));
			if ($keepBusyEntries !== []) {
				$generator->seedBusyFromEntries($keepBusyEntries, $slotTimesById + $allSlotTimes);
			}
			$reset = $keepBusyEntries === [];
			$phaseEntries = 0;
			foreach ($tracks as $trackKey) {
				$trackAssignments = $this->excludeSatisfiedAssignments(
					$byTrack[$trackKey] ?? [],
					array_merge($allEntries, $lockedEntries)
				);
				if ($trackAssignments === []) {
					continue;
				}
				$days = TimetableSchemaModel::weekDaysForTrack($settings, (string) $trackKey);
				$blocked = [];
				foreach ($schema->specialTimesMap($schoolId, $trackKey) as $key => $row) {
					$blocked[$key] = true;
				}
				$trackLabel = TimetableTrack::labels()[$trackKey] ?? $trackKey;
				$this->reportGenerationProgress($jobId, [
					'message' => 'Generating ' . $phaseLabel . ' — ' . $trackLabel . '…',
					'progress' => min(72, $basePct + 5),
					'stage' => $phaseKey,
					'stages' => $stages,
				]);
				$generator->setProgressHandler(function (int $done, int $total, int $left) use ($jobId, $phaseLabel, $trackLabel, $basePct, &$stages, $phaseKey): void {
					$frac = $total > 0 ? min(1, $done / $total) : 0;
					$this->reportGenerationProgress($jobId, [
						'message' => 'Generating ' . $phaseLabel . ' — ' . $trackLabel
							. ' (' . $done . '/' . $total . ($left > 0 ? ', ' . $left . ' left' : '') . ')…',
						'progress' => min(72, $basePct + 5 + (int) round($frac * 16)),
						'stage' => $phaseKey,
						'stages' => $stages,
					]);
				});
				$result = $generator->generate(
					$trackAssignments,
					$schema->generationSlots($schoolId, $trackKey),
					$days,
					$blocked,
					$reset,
					$phaseAssignments
				);
				$reset = false;
				$phaseEntries += count($result['entries']);
				$allEntries = array_merge($allEntries, $result['entries']);
				$allWarnings = array_merge($allWarnings, $result['warnings']);
			}

			$stages = $this->markGenerationStage($stages, $phaseKey, 'done');
			$phaseIndex++;
			$this->reportGenerationProgress($jobId, [
				'message' => $phaseLabel . ' placed (' . $phaseEntries . ' slots).',
				'progress' => (int) round(8 + ($phaseIndex / $phaseCount) * 62),
				'stage' => $phaseKey,
				'stages' => $stages,
			]);
		}

		$stages = $this->markGenerationStage($stages, 'save', 'running');
		$this->reportGenerationProgress($jobId, [
			'message' => 'Saving ' . TimetableTrack::generationPhaseLabel($phase) . '…',
			'progress' => 78,
			'stage' => 'save',
			'stages' => $stages,
		]);

		$fingerprint = $this->assignmentsFingerprint($schoolId, $year, $term);
		$scheduleId = 0;
		$phasesMeta = [];
		$existing = $existingSchedule;
		if ($existing) {
			$scheduleId = (int) $existing['id'];
			$decoded = json_decode((string) ($existing['generated_phases'] ?? ''), true);
			if (is_array($decoded)) {
				$phasesMeta = $decoded;
			}
			if ($phase === 'all' || $classIdList === []) {
				$del = $db->table('timetable_entries')->where('schedule_id', $scheduleId);
				if (!$replaceLocked && $db->fieldExists('is_locked', 'timetable_entries')) {
					$del->groupStart()->where('is_locked', 0)->orWhere('is_locked IS NULL', null, false)->groupEnd();
				}
				$del->delete();
			} else {
				$del = $db->table('timetable_entries')
					->where('schedule_id', $scheduleId)
					->whereIn('class_id', $classIdList);
				if (!$replaceLocked && $db->fieldExists('is_locked', 'timetable_entries')) {
					$del->groupStart()->where('is_locked', 0)->orWhere('is_locked IS NULL', null, false)->groupEnd();
				}
				$del->delete();
			}
		} else {
			$db->table('timetable_schedules')->insert([
				'school_id' => $schoolId,
				'academic_year' => $year,
				'term' => $term,
				'title' => 'Main timetable',
				'status' => 'published',
				'generated_by' => $staffId,
				'generated_at' => date('Y-m-d H:i:s'),
				'assignments_hash' => $fingerprint,
				'needs_regen' => 1,
				'generated_phases' => '{}',
			]);
			$scheduleId = (int) $db->insertID();
		}

		$allSlotTimes = $this->collectSlotTimesById($schoolId, $schema);
		$filtered = (new TimetableConflictService())->filterCollisionFreeEntries(
			$allEntries,
			$allSlotTimes,
			$keepBusyEntries
		);
		if ($filtered['rejected'] !== []) {
			$allWarnings[] = 'Parked ' . count($filtered['rejected'])
				. ' lesson(s) that would have put a teacher in two classes or two teachers in one class.';
		}
		$allEntries = $filtered['kept'];

		$this->insertTimetableEntriesBatch($scheduleId, $schoolId, $allEntries);
		$this->reportGenerationProgress($jobId, [
			'message' => 'Saved ' . count($allEntries) . ' lessons — parking leftover periods…',
			'progress' => 82,
			'stage' => 'save',
			'stages' => $stages,
		]);

		$stagingSvc = new TimetableStagingService();
		$stagingCreated = $stagingSvc->reconcile($scheduleId, $schoolId, $phaseAssignments);
		$stagingSvc->autoPlaceStaging($scheduleId, $schoolId, $schema, 0, 0, false);
		$this->reportGenerationProgress($jobId, [
			'message' => 'Filling morning periods for every class…',
			'progress' => 83,
			'stage' => 'save',
			'stages' => $stages,
		]);
		$stagingSvc->fillMorningGaps($scheduleId, $schoolId, $schema);
		$stagingSvc->fillWeeklyPeriodGaps($scheduleId, $schoolId, $schema);
		$this->reportGenerationProgress($jobId, [
			'message' => 'Clearing collisions without overlaps…',
			'progress' => 84,
			'stage' => 'save',
			'stages' => $stages,
		]);
		$stagingSvc->normalizeScheduleConflicts($scheduleId, $schoolId, $schema);
		$stagingSvc->fillMorningGaps($scheduleId, $schoolId, $schema);
		$stagingSvc->fillWeeklyPeriodGaps($scheduleId, $schoolId, $schema);
		$stagingSvc->parkAllConflicts($scheduleId, $schoolId);
		$stagingCreated += $stagingSvc->reconcile($scheduleId, $schoolId, $phaseAssignments);

		$now = date('Y-m-d H:i:s');
		$entryCountsByPhase = [];
		foreach ($allEntries as $entry) {
			$cid = (int) ($entry['class_id'] ?? 0);
			$track = (string) ($byClassTrack[$cid] ?? $schema->trackForClass($schoolId, $cid));
			$pk = TimetableTrack::generationPhaseKey($track);
			$entryCountsByPhase[$pk] = ($entryCountsByPhase[$pk] ?? 0) + 1;
		}
		$targetPhases = $phase === 'all' ? TimetableTrack::generationPhaseKeys() : [$phase];
		foreach ($targetPhases as $pk) {
			if ($phase === 'all' && !isset($phaseTracks[$pk])) {
				continue;
			}
			if ($phase !== 'all' && !isset($phaseTracks[$pk])) {
				continue;
			}
			$phasesMeta[$pk] = [
				'status' => 'generated',
				'generated_at' => $now,
				'entries' => (int) ($entryCountsByPhase[$pk] ?? 0),
				'hash' => $this->phaseAssignmentsFingerprintFromRows($phaseAssignments, $pk, $schema, $schoolId),
			];
		}

		$allCurrent = true;
		foreach (TimetableTrack::generationPhaseKeys() as $pk) {
			if (!isset($phaseTracks[$pk]) && $phase !== 'all') {
				continue;
			}
			if ($phase === 'all' && !isset($phaseTracks[$pk]) && !$this->phaseHasAssignments($schoolId, $year, $term, $pk, $schema)) {
				continue;
			}
			if ($phase !== 'all' && $pk !== $phase) {
				$meta = $phasesMeta[$pk] ?? null;
				if (!is_array($meta) || ($meta['status'] ?? '') !== 'generated') {
					$allCurrent = false;
					break;
				}
				continue;
			}
			$meta = $phasesMeta[$pk] ?? null;
			if (!is_array($meta) || ($meta['status'] ?? '') !== 'generated') {
				$allCurrent = false;
				break;
			}
		}

		$db->table('timetable_schedules')->where('id', $scheduleId)->update([
			'status' => 'published',
			'generated_by' => $staffId,
			'generated_at' => $now,
			'assignments_hash' => $fingerprint,
			'needs_regen' => $allCurrent ? 0 : 1,
			'generated_phases' => json_encode($phasesMeta),
		]);

		$stages = $this->markGenerationStage($stages, 'save', 'done');
		$this->reportGenerationProgress($jobId, [
			'message' => 'Schedule saved.',
			'progress' => $useGemini ? 86 : 96,
			'stage' => 'save',
			'stages' => $stages,
		]);

		$geminiTip = null;
		if ($useGemini) {
			$stages = $this->markGenerationStage($stages, 'gemini', 'running');
			$this->reportGenerationProgress($jobId, [
				'message' => 'AI checking teacher/class collisions…',
				'progress' => 90,
				'stage' => 'gemini',
				'stages' => $stages,
			]);
			try {
				$geminiTip = $this->applyGeminiCollisionFixes($scheduleId, $schoolId, $schema, $jobId);
			} catch (\Throwable $e) {
				log_message('error', 'Gemini collision check failed: {msg}', ['msg' => $e->getMessage()]);
				$geminiTip = 'AI collision check skipped after an error. Collisions were parked instead.';
			}
			$stagingSvc->normalizeScheduleConflicts($scheduleId, $schoolId, $schema);
			$stagingSvc->fillMorningGaps($scheduleId, $schoolId, $schema);
			$stagingSvc->fillWeeklyPeriodGaps($scheduleId, $schoolId, $schema);
			$stagingSvc->parkAllConflicts($scheduleId, $schoolId);
			$stagingCreated += $stagingSvc->reconcile($scheduleId, $schoolId, $phaseAssignments);
			$stages = $this->markGenerationStage($stages, 'gemini', 'done');
			$this->reportGenerationProgress($jobId, [
				'message' => $geminiTip ?: 'AI collision check complete.',
				'progress' => 96,
				'stage' => 'gemini',
				'stages' => $stages,
			]);
		}

		$this->lockAllPlacedEntries($scheduleId, $phase === 'all' ? [] : $classIdList);

		$collisionReport = $this->buildCollisionReport(
			$scheduleId,
			$schoolId,
			$schema,
			$allWarnings,
			$geminiTip,
			$phaseAssignments,
			$settings
		);
		try {
			$unplaced = $this->buildUnplacedSummary($scheduleId, $schoolId, $schema, $phaseAssignments, $phase, $year, $term);
		} catch (\Throwable $e) {
			log_message('error', 'Unplaced timetable summary failed: {msg}', ['msg' => $e->getMessage()]);
			$unplaced = ['report' => ['missed_periods' => 0, 'missed_courses' => 0, 'missed_teachers' => 0, 'courses' => []], 'pdf' => null];
		}

		return [
			'entries' => $allEntries,
			'warnings' => $allWarnings,
			'schedule_id' => $scheduleId,
			'staging_created' => $stagingCreated,
			'phase' => $phase,
			'ai_collision_tip' => $geminiTip,
			'collision_report' => $collisionReport,
			'unplaced_report' => $unplaced['report'],
			'unplaced_pdf' => $unplaced['pdf'],
		];
	}

	/** @param array<string,mixed> $patch */
	private function reportGenerationProgress(?string $jobId, array $patch): void
	{
		if ($jobId === null || $jobId === '') {
			return;
		}
		if ($this->timetableJobWasDiscarded($jobId)) {
			throw new TimetableJobCancelledException('Generation discarded');
		}
		$this->updateTimetableJob($jobId, $patch);
	}

	/**
	 * @param list<array{key:string,label:string,status:string}> $stages
	 * @return list<array{key:string,label:string,status:string}>
	 */
	private function markGenerationStage(array $stages, string $key, string $status): array
	{
		foreach ($stages as $i => $stage) {
			if (($stage['key'] ?? '') === $key) {
				$stages[$i]['status'] = $status;
			}
		}
		return $stages;
	}

	/**
	 * @return list<array<string,mixed>>
	 */
	private function buildGenerationLevelCards(int $schoolId, int $year, int $term, TimetableSchemaModel $schema, ?array $schedule): array
	{
		$meta = [];
		if ($schedule) {
			$decoded = json_decode((string) ($schedule['generated_phases'] ?? ''), true);
			if (is_array($decoded)) {
				$meta = $decoded;
			}
			// Migrate legacy "secondary" key → high_school
			if (!empty($meta['secondary']) && empty($meta['high_school'])) {
				$meta['high_school'] = $meta['secondary'];
			}
		}
		$db = \Config\Database::connect();
		$cards = [];
		foreach (TimetableTrack::generationPhaseKeys() as $phase) {
			$assignCount = $this->countPhaseAssignments($schoolId, $year, $term, $phase, $schema);
			$classCount = $this->countPhaseClasses($schoolId, $phase, $schema);
			$entryCount = 0;
			if ($schedule && $assignCount > 0) {
				$classIds = $this->phaseClassIds($schoolId, $phase, $schema);
				if ($classIds !== []) {
					$entryCount = (int) $db->table('timetable_entries')
						->where('schedule_id', (int) $schedule['id'])
						->whereIn('class_id', $classIds)
						->where('day_of_week >=', 0)
						->where('slot_id >', 0)
						->countAllResults();
				}
			}
			$phaseMeta = is_array($meta[$phase] ?? null) ? $meta[$phase] : [];
			$currentHash = $assignCount > 0 ? $this->phaseAssignmentsFingerprint($schoolId, $year, $term, $phase, $schema) : '';
			$storedHash = (string) ($phaseMeta['hash'] ?? '');
			$status = 'empty';
			if ($assignCount <= 0) {
				$status = 'empty';
			} elseif ($entryCount > 0 && $storedHash !== '' && hash_equals($storedHash, $currentHash)) {
				$status = 'generated';
			} elseif ($entryCount > 0) {
				$status = 'stale';
			} else {
				$status = 'pending';
			}
			$cards[] = [
				'key' => $phase,
				'label' => TimetableTrack::generationPhaseLabel($phase),
				'hint' => TimetableTrack::generationPhaseHint($phase),
				'icon' => $phase === 'nursery' ? 'fa-child' : ($phase === 'primary' ? 'fa-book' : 'fa-graduation-cap'),
				'status' => $status,
				'assignments' => $assignCount,
				'classes' => $classCount,
				'entries' => $entryCount,
				'generated_at' => $phaseMeta['generated_at'] ?? null,
			];
		}
		return $cards;
	}

	private function countPhaseAssignments(int $schoolId, int $year, int $term, string $phase, TimetableSchemaModel $schema): int
	{
		$count = 0;
		foreach ($this->loadAssignments($schoolId, $year, $term) as $row) {
			$track = $schema->trackForClass($schoolId, (int) ($row['class_id'] ?? 0));
			if (TimetableTrack::generationPhaseKey($track) === $phase) {
				$count++;
			}
		}
		return $count;
	}

	private function phaseHasAssignments(int $schoolId, int $year, int $term, string $phase, TimetableSchemaModel $schema): bool
	{
		return $this->countPhaseAssignments($schoolId, $year, $term, $phase, $schema) > 0;
	}

	private function countPhaseClasses(int $schoolId, string $phase, TimetableSchemaModel $schema): int
	{
		return count($this->phaseClassIds($schoolId, $phase, $schema));
	}

	/** @return list<int> */
	private function phaseClassIds(int $schoolId, string $phase, TimetableSchemaModel $schema): array
	{
		$db = \Config\Database::connect();
		$rows = $db->table('classes')->select('id')->where('school_id', $schoolId)->get()->getResultArray();
		$ids = [];
		foreach ($rows as $row) {
			$id = (int) ($row['id'] ?? 0);
			if ($id <= 0) {
				continue;
			}
			if (TimetableTrack::generationPhaseForClassId($id) === $phase) {
				$ids[] = $id;
			}
		}
		return $ids;
	}

	private function phaseAssignmentsFingerprint(int $schoolId, int $year, int $term, string $phase, TimetableSchemaModel $schema): string
	{
		return $this->phaseAssignmentsFingerprintFromRows(
			$this->loadAssignments($schoolId, $year, $term),
			$phase,
			$schema,
			$schoolId
		);
	}

	/** @param list<array<string,mixed>> $rows */
	private function phaseAssignmentsFingerprintFromRows(array $rows, string $phase, TimetableSchemaModel $schema, int $schoolId): string
	{
		$parts = [];
		foreach ($rows as $row) {
			$track = (string) ($row['_track_key'] ?? $row['track_key'] ?? '');
			if ($track === '') {
				$track = $schema->trackForClass($schoolId, (int) ($row['class_id'] ?? 0));
			}
			if (TimetableTrack::generationPhaseKey($track) !== $phase) {
				continue;
			}
			$parts[] = implode(':', [
				(int) ($row['course_record_id'] ?? 0),
				(int) ($row['course_id'] ?? 0),
				(int) ($row['class_id'] ?? 0),
				(int) ($row['lecturer'] ?? 0),
				(string) ($row['credit'] ?? '0'),
			]);
		}
		sort($parts);
		return hash('sha256', implode('|', $parts));
	}

	/** @param list<array<string,mixed>> $entries */
	private function insertTimetableEntriesBatch(int $scheduleId, int $schoolId, array $entries): void
	{
		if ($scheduleId <= 0 || $entries === []) {
			return;
		}
		$db = \Config\Database::connect();
		$hasLock = $db->fieldExists('is_locked', 'timetable_entries');
		$chunk = [];
		foreach ($entries as $entry) {
			$row = [
				'schedule_id' => $scheduleId,
				'school_id' => $schoolId,
				'class_id' => (int) ($entry['class_id'] ?? 0),
				'staff_id' => (int) ($entry['staff_id'] ?? 0),
				'course_id' => (int) ($entry['course_id'] ?? 0),
				'course_record_id' => !empty($entry['course_record_id']) ? (int) $entry['course_record_id'] : null,
				'day_of_week' => (int) ($entry['day_of_week'] ?? 0),
				'slot_id' => (int) ($entry['slot_id'] ?? 0),
				'entry_type' => (string) ($entry['entry_type'] ?? 'lesson'),
			];
			if ($hasLock) {
				$row['is_locked'] = !empty($entry['is_locked']) ? 1 : 0;
			}
			$chunk[] = $row;
			if (count($chunk) >= 200) {
				$db->table('timetable_entries')->insertBatch($chunk);
				$chunk = [];
			}
		}
		if ($chunk !== []) {
			$db->table('timetable_entries')->insertBatch($chunk);
		}
	}

	/**
	 * Freeze every placed lesson so a later generate cannot wipe the grid
	 * unless Replace locked timetable is checked.
	 *
	 * @param list<int> $classIdList
	 */
	private function lockAllPlacedEntries(int $scheduleId, array $classIdList = []): int
	{
		if ($scheduleId <= 0) {
			return 0;
		}
		$db = \Config\Database::connect();
		if (!$db->fieldExists('is_locked', 'timetable_entries')) {
			return 0;
		}
		$q = $db->table('timetable_entries')
			->where('schedule_id', $scheduleId)
			->where('entry_type', 'lesson')
			->where('day_of_week >=', 0)
			->where('slot_id >', 0)
			->groupStart()->where('is_locked', 0)->orWhere('is_locked IS NULL', null, false)->groupEnd();
		if ($classIdList !== []) {
			$q->whereIn('class_id', $classIdList);
		}
		$q->update(['is_locked' => 1]);
		return $db->affectedRows();
	}

	private function applyGeminiCollisionFixes(int $scheduleId, int $schoolId, TimetableSchemaModel $schema, ?string $jobId = null): ?string
	{
		$checker = new TimetableConflictService();
		$conflicts = $checker->findScheduleConflicts($scheduleId, $schoolId, $schema);
		if ($conflicts === []) {
			return 'No teacher/class collisions found.';
		}

		$db = \Config\Database::connect();
		$movableQ = $db->table('timetable_entries te')
			->select('te.id AS entry_id, te.class_id, te.staff_id, te.day_of_week AS day, te.slot_id, c.title AS course')
			->join('courses c', 'c.id = te.course_id', 'left')
			->where('te.schedule_id', $scheduleId)
			->where('te.entry_type', 'lesson')
			->where('te.day_of_week >=', 0)
			->where('te.slot_id >', 0);
		if ($db->fieldExists('is_locked', 'timetable_entries')) {
			$movableQ->groupStart()->where('te.is_locked', 0)->orWhere('te.is_locked IS NULL', null, false)->groupEnd();
		}
		$movable = $movableQ->limit(60)->get()->getResultArray();

		$busy = [];
		foreach ($movable as $row) {
			$busy[(int) $row['day'] . ':' . (int) $row['slot_id'] . ':c' . (int) $row['class_id']] = true;
			$busy[(int) $row['day'] . ':' . (int) $row['slot_id'] . ':s' . (int) $row['staff_id']] = true;
		}

		$freeSlots = [];
		$days = [0, 1, 2, 3, 4];
		foreach (TimetableTrack::tracksForSchool($schoolId) ?: [TimetableTrack::ALL] as $track) {
			foreach ($schema->teachingSlots($schoolId, $track) as $slot) {
				$slotId = (int) ($slot['id'] ?? 0);
				if ($slotId <= 0) {
					continue;
				}
				foreach ($days as $day) {
					$freeSlots[] = [
						'day' => $day,
						'slot_id' => $slotId,
						'label' => (string) ($slot['label'] ?? $slotId),
					];
				}
			}
		}
		$freeSlots = array_slice($freeSlots, 0, 100);

		$gemini = new GeminiTimetable();
		$moves = $gemini->suggestCollisionMoves($conflicts, $freeSlots, $movable, [
			'school_id' => $schoolId,
			'schedule_id' => $scheduleId,
		]);
		$applied = 0;
		foreach ($moves as $move) {
			$entryId = (int) ($move['entry_id'] ?? 0);
			$day = (int) ($move['day'] ?? -1);
			$slotId = (int) ($move['slot_id'] ?? 0);
			if ($entryId <= 0 || $day < 0 || $slotId <= 0) {
				continue;
			}
			$hit = $checker->checkMove($scheduleId, $schoolId, $entryId, $day, $slotId, $schema);
			if ($hit !== []) {
				continue;
			}
			$db->table('timetable_entries')->where('id', $entryId)->where('schedule_id', $scheduleId)->update([
				'day_of_week' => $day,
				'slot_id' => $slotId,
			]);
			$applied++;
		}

		$remaining = $checker->findScheduleConflicts($scheduleId, $schoolId, $schema);
		$tip = 'AI applied ' . $applied . ' collision fix' . ($applied === 1 ? '' : 'es')
			. '; ' . count($remaining) . ' conflict' . (count($remaining) === 1 ? '' : 's') . ' remaining.';
		if ($remaining !== []) {
			$staging = new TimetableStagingService();
			$staging->normalizeScheduleConflicts($scheduleId, $schoolId, $schema);
			$remaining = $checker->findScheduleConflicts($scheduleId, $schoolId, $schema);
			$tip .= ' Auto-normalize left ' . count($remaining) . '.';
		}
		$this->reportGenerationProgress($jobId, ['message' => $tip]);
		return $tip;
	}

	/**
	 * @param array{entries:list<array<string,mixed>>,warnings:list<string>,schedule_id:int,staging_created:int} $result
	 */
	private function buildGenerationAiTip(bool $useGemini, int $schoolId, int $year, int $term, array $result): ?string
	{
		if (!$useGemini) {
			return null;
		}

		try {
			$gemini = new GeminiTimetable();
			if (!$gemini->isConfigured()) {
				return null;
			}

			if ($result['warnings'] !== []) {
				return $gemini->suggestFixes($result['warnings'], [
					'school_id' => $schoolId,
					'year' => $year,
					'term' => $term,
					'entries' => count($result['entries']),
				]);
			}

			$db = \Config\Database::connect();
			$sample = $db->table('timetable_entries te')
				->select('te.day_of_week, te.class_id, c.title AS course_title, c.credit, COUNT(*) AS periods')
				->join('courses c', 'c.id = te.course_id', 'left')
				->where('te.schedule_id', (int) $result['schedule_id'])
				->where('te.day_of_week >=', 0)
				->where('te.slot_id >', 0)
				->groupBy('te.class_id, te.day_of_week, te.course_id, c.title, c.credit')
				->having('periods >', 1)
				->orderBy('c.credit', 'ASC')
				->limit(25)
				->get()->getResultArray();
			return $gemini->reviewQuality($sample, [
				'school_id' => $schoolId,
				'year' => $year,
				'term' => $term,
				'entries' => count($result['entries']),
				'rule' => '2 periods/week must be on different days',
			]);
		} catch (\Throwable $e) {
			log_message('error', 'Timetable AI tip failed: {msg}', ['msg' => $e->getMessage()]);
			return null;
		}
	}

	private function repairGenerationState(int $schoolId, TimetableSchemaModel $schema): void
	{
		$schema->ensureSchema();
		$schema->repairOrphanEntrySlots($schoolId);
		$schema->ensureTrackSlots($schoolId, TimetableTrack::ALL);
		if (!$schema->isSharedSchedule($schoolId)) {
			foreach (TimetableTrack::tracksForSchool($schoolId) as $track) {
				$schema->ensureTrackSlots($schoolId, $track);
				$schema->sanitizeTrackSlots($schoolId, $track);
			}
		}
	}

	private function timetableJobDir(): string
	{
		$dir = WRITEPATH . 'timetable_jobs';
		if (!is_dir($dir)) {
			@mkdir($dir, 0755, true);
		}
		return $dir;
	}

	private function timetableJobPath(string $jobId): string
	{
		$safe = preg_replace('/[^A-Za-z0-9_\-]/', '', $jobId);
		return $this->timetableJobDir() . DIRECTORY_SEPARATOR . $safe . '.json';
	}

	/** @return array<string,mixed>|null */
	private function readTimetableJob(string $jobId): ?array
	{
		$file = $this->timetableJobPath($jobId);
		if (!is_file($file)) {
			return null;
		}
		$data = json_decode((string) file_get_contents($file), true);
		return is_array($data) ? $data : null;
	}

	/** @param array<string,mixed> $job */
	private function writeTimetableJob(array $job): void
	{
		if (empty($job['id'])) {
			return;
		}
		$job['updated_at'] = date('Y-m-d H:i:s');
		file_put_contents($this->timetableJobPath((string) $job['id']), json_encode($job, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
	}

	/** @param array<string,mixed> $payload */
	private function createTimetableJob(array $payload): string
	{
		$this->cleanupOldTimetableJobs();
		$jobId = date('YmdHis') . '_' . bin2hex(random_bytes(4));
		$job = [
			'id' => $jobId,
			'status' => 'queued',
			'message' => 'Queued for generation.',
			'progress' => 0,
			'stage' => 'queued',
			'stages' => [],
			'created_at' => date('Y-m-d H:i:s'),
			'started_at' => null,
			'finished_at' => null,
			'success' => null,
			'warnings' => [],
			'ai_tip' => null,
			'schedule_id' => 0,
			'staging_created' => 0,
		] + $payload;
		$this->writeTimetableJob($job);
		return $jobId;
	}

	/** @param array<string,mixed> $patch */
	private function updateTimetableJob(string $jobId, array $patch): ?array
	{
		$job = $this->readTimetableJob($jobId);
		if (!$job) {
			return null;
		}
		if ((string) ($job['status'] ?? '') === 'cancelled' && (string) ($patch['status'] ?? '') !== 'cancelled') {
			return $job;
		}
		$job = array_merge($job, $patch);
		$this->writeTimetableJob($job);
		return $job;
	}

	/**
	 * @param list<string> $warnings
	 * @param list<array<string,mixed>> $assignments
	 * @param array<string,mixed>|null $settings
	 * @return array<string,mixed>
	 */
	private function buildCollisionReport(
		int $scheduleId,
		int $schoolId,
		TimetableSchemaModel $schema,
		array $warnings,
		?string $geminiTip,
		array $assignments = [],
		?array $settings = null
	): array {
		$checker = new TimetableConflictService();
		$summary = $checker->summarizeConflicts($checker->findScheduleConflicts($scheduleId, $schoolId, $schema));
		$summary['warnings'] = array_values(array_slice($warnings, 0, 40));
		$summary['ai_tip'] = $geminiTip;
		$summary['ok'] = ((int) ($summary['total'] ?? 0)) === 0;
		$summary['grid_clean'] = $summary['ok'];
		$summary['assignment_alerts'] = $assignments === []
			? []
			: $checker->assignmentLoadAlerts($assignments, $schema, $schoolId, $settings);
		return $summary;
	}

	/**
	 * Drop Manage Course rows already filled by a combined-class copy from another track.
	 *
	 * @param list<array<string,mixed>> $assignments
	 * @param list<array<string,mixed>> $entries
	 * @return list<array<string,mixed>>
	 */
	private function excludeSatisfiedAssignments(array $assignments, array $entries): array
	{
		$have = [];
		foreach ($entries as $entry) {
			$key = (int) ($entry['class_id'] ?? 0) . ':' . (int) ($entry['course_id'] ?? 0);
			$have[$key] = (int) ($have[$key] ?? 0) + 1;
		}
		$out = [];
		foreach ($assignments as $row) {
			$needed = TimetableGeneratorService::weeklyHoursFromCourse($row);
			$key = (int) ($row['class_id'] ?? 0) . ':' . (int) ($row['course_id'] ?? 0);
			$already = (int) ($have[$key] ?? 0);
			if ($needed > 0 && $already >= $needed) {
				continue;
			}
			if ($already > 0) {
				$row['weekly_hours'] = max(0, $needed - $already);
			}
			$out[] = $row;
		}
		return $out;
	}

	/**
	 * @param list<string> $tracks
	 * @return array<string,array<string,int>>
	 */
	private function trackClockSlotMap(int $schoolId, TimetableSchemaModel $schema, array $tracks): array
	{
		$map = [];
		foreach ($tracks as $track) {
			$track = (string) $track;
			foreach ($schema->generationSlots($schoolId, $track) as $slot) {
				$id = (int) ($slot['id'] ?? 0);
				if ($id <= 0) {
					continue;
				}
				$key = TimetableSchemaModel::slotClock((string) ($slot['start_time'] ?? ''))
					. '|' . TimetableSchemaModel::slotClock((string) ($slot['end_time'] ?? ''));
				$map[$track][$key] = $id;
			}
		}
		return $map;
	}

	/** @return array<int,array{start:string,end:string}> */
	private function collectSlotTimesById(int $schoolId, TimetableSchemaModel $schema): array
	{
		$out = [];
		$tracks = TimetableTrack::tracksForSchool($schoolId) ?: [TimetableTrack::ALL];
		$tracks[] = TimetableTrack::ALL;
		foreach (array_unique($tracks) as $track) {
			foreach ($schema->generationSlots($schoolId, (string) $track) as $slot) {
				$id = (int) ($slot['id'] ?? 0);
				if ($id <= 0) {
					continue;
				}
				$out[$id] = [
					'start' => (string) ($slot['start_time'] ?? '00:00:00'),
					'end' => (string) ($slot['end_time'] ?? '00:00:00'),
				];
			}
		}
		return $out;
	}

	/** @param list<array<string,mixed>> $assignments */
	private function uniqueAssignmentCourses(array $assignments): array
	{
		$out = [];
		foreach ($assignments as $row) {
			$id = (int) ($row['course_id'] ?? 0);
			if ($id <= 0 || isset($out[$id])) {
				continue;
			}
			$out[$id] = [
				'id' => $id,
				'title' => (string) ($row['course_title'] ?? 'Course'),
			];
		}
		return array_values($out);
	}

	/** @return array<string,mixed>|null */
	private function findLastFinishedTimetableJob(int $schoolId, int $year, int $term): ?array
	{
		$best = null;
		foreach (glob($this->timetableJobDir() . DIRECTORY_SEPARATOR . '*.json') ?: [] as $file) {
			$data = json_decode((string) @file_get_contents($file), true);
			if (!is_array($data) || (string) ($data['status'] ?? '') !== 'done') {
				continue;
			}
			if ((int) ($data['school_id'] ?? 0) !== $schoolId
				|| (int) ($data['academic_year'] ?? 0) !== $year
				|| (int) ($data['term'] ?? 0) !== $term) {
				continue;
			}
			$stamp = (string) ($data['finished_at'] ?? $data['created_at'] ?? '');
			if ($best === null || $stamp > (string) ($best['finished_at'] ?? $best['created_at'] ?? '')) {
				$best = $data;
			}
		}
		return $best;
	}

	/** @return array<string,mixed>|null */
	private function findExistingTimetableJob(int $schoolId, int $year, int $term): ?array
	{
		foreach (glob($this->timetableJobDir() . DIRECTORY_SEPARATOR . '*.json') ?: [] as $file) {
			$data = json_decode((string) @file_get_contents($file), true);
			if (!is_array($data)) {
				continue;
			}
			$status = (string) ($data['status'] ?? '');
			if ((int) ($data['school_id'] ?? 0) !== $schoolId
				|| (int) ($data['academic_year'] ?? 0) !== $year
				|| (int) ($data['term'] ?? 0) !== $term
				|| !in_array($status, ['queued', 'running'], true)) {
				continue;
			}
			return $data;
		}
		return null;
	}

	private function timetableJobWasDiscarded(?string $jobId): bool
	{
		if ($jobId === null || $jobId === '') {
			return false;
		}
		$job = $this->readTimetableJob($jobId);
		return is_array($job) && (string) ($job['status'] ?? '') === 'cancelled';
	}

	/** @param array<string,mixed> $job */
	private function timetableJobLooksStale(array $job): bool
	{
		if (!in_array((string) ($job['status'] ?? ''), ['queued', 'running'], true)) {
			return false;
		}
		$updated = strtotime((string) ($job['updated_at'] ?? '')) ?: 0;
		if ($updated <= 0) {
			$path = $this->timetableJobPath((string) ($job['id'] ?? ''));
			$updated = is_file($path) ? (int) @filemtime($path) : 0;
		}
		if ($updated <= 0) {
			$updated = strtotime((string) ($job['started_at'] ?? $job['created_at'] ?? '')) ?: 0;
		}
		return $updated > 0 && (time() - $updated) >= 480;
	}

	private function cancelTimetableJob(string $jobId, string $message = 'Generation discarded.'): void
	{
		$jobId = preg_replace('/[^A-Za-z0-9_\-]/', '', $jobId);
		if ($jobId === '') {
			return;
		}
		$this->updateTimetableJob($jobId, [
			'status' => 'cancelled',
			'success' => false,
			'message' => $message,
			'finished_at' => date('Y-m-d H:i:s'),
		]);
		$lock = $this->timetableJobPath($jobId) . '.lock';
		if (is_file($lock)) {
			@unlink($lock);
		}
	}

	private function discardActiveTimetableJobs(int $schoolId, int $year, int $term): int
	{
		$n = 0;
		foreach (glob($this->timetableJobDir() . DIRECTORY_SEPARATOR . '*.json') ?: [] as $file) {
			$data = json_decode((string) @file_get_contents($file), true);
			if (!is_array($data)) {
				continue;
			}
			if ((int) ($data['school_id'] ?? 0) !== $schoolId
				|| (int) ($data['academic_year'] ?? 0) !== $year
				|| (int) ($data['term'] ?? 0) !== $term
				|| !in_array((string) ($data['status'] ?? ''), ['queued', 'running'], true)) {
				continue;
			}
			$this->cancelTimetableJob((string) ($data['id'] ?? ''), 'Generation discarded.');
			$n++;
		}
		return $n;
	}

	private function cleanupOldTimetableJobs(): void
	{
		$cutoff = time() - 86400;
		foreach (glob($this->timetableJobDir() . DIRECTORY_SEPARATOR . '*.json') ?: [] as $file) {
			if (@filemtime($file) !== false && (int) @filemtime($file) < $cutoff) {
				@unlink($file);
			}
		}
	}

	private function spawnTimetableWorker(string $jobId): array
	{
		$root = defined('ROOTPATH') ? ROOTPATH : (FCPATH . '..' . DIRECTORY_SEPARATOR);
		$spark = rtrim($root, '/\\') . DIRECTORY_SEPARATOR . 'spark';
		$php = 'php';
		foreach (['/usr/local/bin/php', '/usr/bin/php'] as $bin) {
			if (is_file($bin)) {
				$php = $bin;
				break;
			}
		}
		if (defined('PHP_BINARY') && PHP_BINARY
			&& stripos(PHP_BINARY, 'cgi') === false
			&& stripos(PHP_BINARY, 'fpm') === false) {
			$php = PHP_BINARY;
		}
		$logDir = WRITEPATH . 'timetable_jobs';
		if (!is_dir($logDir)) {
			@mkdir($logDir, 0755, true);
		}
		$log = $logDir . DIRECTORY_SEPARATOR . 'worker.log';
		$isWin = (DIRECTORY_SEPARATOR === '\\');

		// Prefer spark CLI worker (true background, progress file updates while UI polls).
		if (is_file($spark)) {
			$run = escapeshellarg($php) . ' ' . escapeshellarg($spark) . ' process:timetable-jobs ' . escapeshellarg($jobId);
			if ($isWin) {
				$cmd = 'start /B "" ' . $run . ' >> ' . escapeshellarg($log) . ' 2>&1';
				@pclose(@popen($cmd, 'r'));
			} else {
				$cmd = 'nohup ' . $run . ' >> ' . escapeshellarg($log) . ' 2>&1 & echo $!';
				@exec($cmd);
			}
		}

		// Loopback HTTP runner as backup (HMAC-protected).
		$token = $this->timetableJobToken($jobId);
		$basePath = parse_url((string) (env('app.baseURL') ?: '/'), PHP_URL_PATH);
		$basePath = is_string($basePath) ? rtrim($basePath, '/') : '';
		$url = 'http://127.0.0.1' . $basePath . '/timetable/run_job/' . rawurlencode($jobId) . '?token=' . rawurlencode($token);
		if ($isWin) {
			@pclose(@popen('start /B curl -s -m 900 ' . escapeshellarg($url) . ' >> ' . escapeshellarg($log) . ' 2>&1', 'r'));
		} else {
			@exec('nohup curl -s -m 900 ' . escapeshellarg($url) . ' >> ' . escapeshellarg($log) . ' 2>&1 &');
			// If curl is missing, fall back to PHP stream in background.
			@exec('nohup ' . escapeshellarg($php) . ' -r ' . escapeshellarg('@file_get_contents(' . var_export($url, true) . ');') . ' >> ' . escapeshellarg($log) . ' 2>&1 &');
		}

		return ['started' => true, 'job_id' => $jobId];
	}

	/**
	 * @deprecated Use spawnTimetableWorker — shutdown kicks block the generate HTTP response.
	 */
	private function kickTimetableJobAsync(string $jobId): void
	{
		$this->spawnTimetableWorker($jobId);
	}

	/** @return array<string,mixed> */
	public function processTimetableJobById(string $jobId): array
	{
		$job = $this->readTimetableJob($jobId);
		if (!$job) {
			return ['ok' => false, 'error' => 'Job not found'];
		}
		if (in_array((string) ($job['status'] ?? ''), ['done', 'failed', 'cancelled'], true)) {
			return ['ok' => true, 'already_finished' => true, 'job_id' => $jobId];
		}

		$lock = $this->timetableJobPath($jobId) . '.lock';
		$fh = @fopen($lock, 'c+');
		if (!$fh || !flock($fh, LOCK_EX | LOCK_NB)) {
			return ['ok' => false, 'busy' => true, 'job_id' => $jobId];
		}

		try {
			$job = $this->readTimetableJob($jobId) ?? $job;
			if (in_array((string) ($job['status'] ?? ''), ['cancelled', 'done', 'failed'], true)) {
				return ['ok' => true, 'cancelled' => ($job['status'] ?? '') === 'cancelled', 'job_id' => $jobId];
			}
			$schoolId = (int) ($job['school_id'] ?? 0);
			$staffId = (int) ($job['staff_id'] ?? 0);
			$year = (int) ($job['academic_year'] ?? 0);
			$term = (int) ($job['term'] ?? 1);
			$useGemini = !empty($job['use_gemini']);
			$replaceLocked = !empty($job['replace_locked']);
			$phase = TimetableTrack::normalizeGenerationPhase($job['phase'] ?? 'all');
			$schema = new TimetableSchemaModel();
			$this->updateTimetableJob($jobId, [
				'status' => 'running',
				'message' => 'Starting ' . TimetableTrack::generationPhaseLabel($phase) . '…',
				'progress' => 4,
				'stage' => 'starting',
				'phase' => $phase,
				'started_at' => date('Y-m-d H:i:s'),
			]);
			$schema->ensureSchema();
			$result = $this->runGeneration($schoolId, $staffId, $schema, $year, $term, $jobId, $phase, $useGemini, $replaceLocked);
			if ($this->timetableJobWasDiscarded($jobId)) {
				return ['ok' => true, 'cancelled' => true, 'job_id' => $jobId];
			}
			if ($result === null) {
				$this->updateTimetableJob($jobId, [
					'status' => 'failed',
					'success' => false,
					'message' => 'No course assignments found for this level. Assign courses first.',
					'progress' => 0,
					'finished_at' => date('Y-m-d H:i:s'),
				]);
				return ['ok' => false, 'job_id' => $jobId, 'error' => 'No assignments'];
			}
			$aiTip = $this->buildGenerationAiTip($useGemini, $schoolId, $year, $term, $result);
			if (!empty($result['ai_collision_tip'])) {
				$aiTip = trim((string) ($aiTip ?? '') . "\n" . $result['ai_collision_tip']);
			}
			$phaseLabel = TimetableTrack::generationPhaseLabel((string) ($result['phase'] ?? $phase));
			$hits = (int) (($result['collision_report']['total'] ?? 0));
			$missed = (int) (($result['unplaced_report']['missed_periods'] ?? 0));
			$this->updateTimetableJob($jobId, [
				'status' => 'done',
				'success' => true,
				'message' => $phaseLabel . ' generated — ' . count($result['entries']) . ' lesson slots'
					. (!empty($result['staging_created']) ? ' (' . (int) $result['staging_created'] . ' in parking lot)' : '')
					. ($hits > 0 ? '. ' . $hits . ' collision' . ($hits === 1 ? '' : 's') . ' still need a move.' : '. No teacher/class collisions.')
					. ($missed > 0 ? ' ' . $missed . ' period' . ($missed === 1 ? '' : 's') . ' parked — see PDF.' : ''),
				'progress' => 100,
				'stage' => 'done',
				'phase' => $result['phase'] ?? $phase,
				'warnings' => $result['warnings'],
				'ai_tip' => $aiTip !== '' ? $aiTip : null,
				'collision_report' => $result['collision_report'] ?? null,
				'unplaced_report' => $result['unplaced_report'] ?? null,
				'unplaced_pdf' => $result['unplaced_pdf'] ?? null,
				'schedule_id' => (int) ($result['schedule_id'] ?? 0),
				'staging_created' => (int) ($result['staging_created'] ?? 0),
				'finished_at' => date('Y-m-d H:i:s'),
			]);
			return ['ok' => true, 'job_id' => $jobId];
		} catch (TimetableJobCancelledException $e) {
			$this->cancelTimetableJob($jobId, 'Generation discarded.');
			return ['ok' => true, 'cancelled' => true, 'job_id' => $jobId];
		} catch (\Throwable $e) {
			log_message('error', 'Timetable background job failed [{job}]: {msg}', [
				'job' => $jobId,
				'msg' => $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine(),
			]);
			$this->updateTimetableJob($jobId, [
				'status' => 'failed',
				'success' => false,
				'message' => 'Generation failed after background retry. Please review timetable assignments and try again.',
				'progress' => 0,
				'detail' => ENVIRONMENT !== 'production' ? $e->getMessage() : null,
				'finished_at' => date('Y-m-d H:i:s'),
			]);
			return ['ok' => false, 'job_id' => $jobId, 'error' => $e->getMessage()];
		} finally {
			if ($fh) {
				flock($fh, LOCK_UN);
				fclose($fh);
			}
			@unlink($lock);
		}
	}

	private function ensureTimetableGenerated(int $schoolId, TimetableSchemaModel $schema): void
	{
		$db = \Config\Database::connect();
		$year = (int) ($this->data['academic_year'] ?? 0);
		$term = (int) ($this->data['term'] ?? 1);
		if ($year <= 0) {
			return;
		}
		if ($this->countAssignments($schoolId, $year, $term) <= 0) {
			return;
		}

		// Do not auto-queue. Stale/empty schedules are fixed via Generate smart timetable.
		if ($this->isTimetableStale($schoolId, $year, $term)) {
			return;
		}

		$schedule = $db->table('timetable_schedules')
			->where('school_id', $schoolId)->where('academic_year', $year)->where('term', $term)
			->orderBy('id', 'DESC')->get(1)->getRowArray();

		$scheduledCount = 0;
		if ($schedule) {
			$scheduledCount = (int) $db->table('timetable_entries')
				->where('schedule_id', (int) $schedule['id'])
				->where('day_of_week >=', 0)
				->where('slot_id >', 0)
				->countAllResults();
		}

		if ($scheduledCount > 0) {
			return;
		}
	}

	public function class_timetable($classId = 0)
	{
		$this->denyMenu('timetable_dashboard');
		list($schoolId, , $schema) = $this->bootTimetable();
		$classId = (int) $classId;
		$data = $this->buildGridView($schoolId, $schema, 'class', $classId, true);
		$data['page'] = 'timetable_class';
		$data['content'] = view('pages/timetable/class_view', $data);
		return view('main', $data);
	}

	public function teacher_timetable($staffId = 0)
	{
		$this->denyMenu('timetable_dashboard');
		list($schoolId, , $schema) = $this->bootTimetable();
		$staffId = (int) $staffId;
		$data = $this->buildGridView($schoolId, $schema, 'teacher', $staffId, true);
		$data['page'] = 'timetable_teacher';
		$data['content'] = view('pages/timetable/teacher_view', $data);
		return view('main', $data);
	}

	public function print_class($classId = 0)
	{
		$this->denyMenu('timetable_dashboard');
		list($schoolId, , $schema) = $this->bootTimetable();
		$data = $this->gridBodyViewData(
			$this->buildGridView($schoolId, $schema, 'class', (int) $classId, false, false),
			true
		);
		$slug = preg_replace('/[^A-Za-z0-9_\-]+/', '_', $data['title'] ?? 'class');
		return $this->outputTimetablePdf([$data], 'Class_' . $slug, null, false);
	}

	public function print_teacher($staffId = 0)
	{
		$this->denyMenu('timetable_dashboard');
		list($schoolId, , $schema) = $this->bootTimetable();
		$data = $this->gridBodyViewData(
			$this->buildGridView($schoolId, $schema, 'teacher', (int) $staffId, false, false),
			true
		);
		$slug = preg_replace('/[^A-Za-z0-9_\-]+/', '_', $data['title'] ?? 'teacher');
		return $this->outputTimetablePdf([$data], 'Teacher_' . $slug, null, false);
	}

	public function pdf_all_classes($phase = 'all')
	{
		$this->denyMenu('timetable_dashboard');
		try {
			@ini_set('memory_limit', '512M');
			@set_time_limit(180);
			list($schoolId, , $schema) = $this->bootTimetable();
			$phase = TimetableTrack::normalizeGenerationPhase(
				$phase !== '' && $phase !== null ? $phase : $this->request->getGet('phase')
			);
			$label = TimetableTrack::generationPhaseLabel($phase);
			$db = \Config\Database::connect();
			$sheets = [];
			$classIds = $phase === 'all'
				? array_map(static fn ($c) => (int) ($c['id'] ?? 0), $this->fetchClassRows($db, $schoolId))
				: $this->phaseClassIds($schoolId, $phase, $schema);
			foreach ($classIds as $classId) {
				$classId = (int) $classId;
				if ($classId <= 0) {
					continue;
				}
				try {
					$grid = $this->buildGridView($schoolId, $schema, 'class', $classId, false, false);
					if (!empty($grid['schedule'])) {
						$sheets[] = $this->gridBodyViewData($grid, true);
					}
				} catch (\Throwable $e) {
					log_message('error', 'Timetable class PDF skipped [{id}]: {msg}', [
						'id' => $classId,
						'msg' => $e->getMessage(),
					]);
				}
			}
			if ($sheets === []) {
				$this->session->setFlashdata('error', 'No ' . $label . ' class timetables to export yet.');
				return redirect()->to(site_url('timetable/dashboard'));
			}
			$prefix = 'All_Class_Timetables';
			if ($phase === 'nursery') {
				$prefix = 'Nursery_Class_Timetables';
			} elseif ($phase === 'primary') {
				$prefix = 'Primary_Class_Timetables';
			} elseif ($phase === 'high_school') {
				$prefix = 'High_School_Class_Timetables';
			}
			$cover = $phase === 'all'
				? 'All class timetables'
				: $label . ' class timetables';
			return $this->outputTimetablePdf($sheets, $prefix, $cover);
		} catch (\Throwable $e) {
			log_message('error', 'Timetable level PDF failed: {msg}', [
				'msg' => $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine(),
			]);
			$this->session->setFlashdata('error', 'Could not build the class PDF. ' . $e->getMessage());
			return redirect()->to(site_url('timetable/dashboard'));
		}
	}

	public function pdf_all_teachers()
	{
		$this->denyMenu('timetable_dashboard');
		list($schoolId, , $schema) = $this->bootTimetable();
		$db = \Config\Database::connect();
		$sheets = [];
		$year = (int) ($this->data['academic_year'] ?? 0);
		$term = (int) ($this->data['term'] ?? 1);
		$schedule = $db->table('timetable_schedules')
			->where('school_id', $schoolId)->where('academic_year', $year)->where('term', $term)
			->orderBy('id', 'DESC')->get(1)->getRowArray();
		$staffs = $this->fetchTimetableStaffRows($db, $schoolId, $year, $term, (int) ($schedule['id'] ?? 0));
		foreach ($staffs as $staff) {
			$grid = $this->buildGridView($schoolId, $schema, 'teacher', (int) $staff['id'], false, false);
			if (!empty($grid['schedule'])) {
				$sheets[] = $this->gridBodyViewData($grid, true);
			}
		}
		return $this->outputTimetablePdf($sheets, 'All_Teacher_Timetables', 'All teacher / staff timetables');
	}

	public function pdf_unplaced($jobId = '')
	{
		$this->denyMenu('timetable_dashboard');
		list($schoolId, , $schema) = $this->bootTimetable();
		$jobId = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) $jobId);
		if ($jobId !== '') {
			$job = $this->readTimetableJob($jobId);
			if (is_array($job) && (int) ($job['school_id'] ?? 0) === $schoolId) {
				$file = (string) ($job['unplaced_pdf'] ?? '');
				$path = $this->unplacedPdfPath($file);
				if ($file !== '' && is_file($path)) {
					return $this->response->download($path, null)->setFileName($file);
				}
			}
		}
		$year = (int) ($this->data['academic_year'] ?? 0);
		$term = (int) ($this->data['term'] ?? 1);
		$db = \Config\Database::connect();
		$schedule = $db->table('timetable_schedules')
			->where('school_id', $schoolId)
			->where('academic_year', $year)
			->where('term', $term)
			->orderBy('id', 'DESC')
			->get(1)->getRowArray();
		if (!$schedule) {
			$this->session->setFlashdata('error', 'Generate a timetable first.');
			return redirect()->to(site_url('timetable/dashboard'));
		}
		$built = $this->buildUnplacedSummary((int) $schedule['id'], $schoolId, $schema, $this->loadAssignments($schoolId, $year, $term), 'all', $year, $term);
		if (!empty($built['pdf'])) {
			$path = $this->unplacedPdfPath((string) $built['pdf']);
			if (is_file($path)) {
				return $this->response->download($path, null)->setFileName((string) $built['pdf']);
			}
		}
		return $this->response
			->setHeader('Content-Type', 'text/html; charset=UTF-8')
			->setBody($this->renderUnplacedPdfHtml($built['full'] ?? $built['report'] ?? [], $year, $term)
				. '<script>window.onload=function(){window.print();}</script>');
	}

	private function countAssignments(int $schoolId, int $year, int $term): int
	{
		return count($this->loadAssignments($schoolId, $year, $term));
	}

	private function countTestAssignments(int $schoolId, int $year): int
	{
		$db = \Config\Database::connect();
		if (!$db->fieldExists('create_source', 'courses')) {
			return 0;
		}
		return (int) $db->table('course_records cr')
			->join('courses c', 'c.id = cr.course')
			->join('classes cl', 'cl.id = cr.class')
			->where('cl.school_id', $schoolId)
			->where('cr.year', $year)
			->where('c.create_source', 'timetable_test')
			->countAllResults();
	}

	/** @return list<array<string,mixed>> */
	private function loadAssignments(int $schoolId, int $year, int $term): array
	{
		$db = \Config\Database::connect();
		$rows = $db->table('course_records cr')
			->select('cr.id AS course_record_id, cr.course AS course_id, cr.lecturer, cr.class AS class_id,
				cl.level AS class_level_id,
				c.title AS course_title, c.code AS course_code, c.credit, c.marks, c.program_type,
				cc.title AS category_title,
				cl.title AS class_title, l.title AS level_name,
				d.code AS dept_code, d.title AS dept_title,
				CONCAT(s.fname, " ", s.lname) AS teacher_name')
			->join('courses c', 'c.id = cr.course')
			->join('course_category cc', 'cc.id = c.category', 'left')
			->join('classes cl', 'cl.id = cr.class')
			->join('levels l', 'l.id = cl.level', 'left')
			->join('departments d', 'd.id = cl.department', 'left')
			->join('staffs s', 's.id = cr.lecturer', 'left')
			->where('cl.school_id', $schoolId)
			->where('cr.year', $year)
			->where("find_in_set($term, cr.term) > 0", null, false)
			->orderBy('cl.title')->orderBy('c.title')
			->get()->getResultArray();

		return $this->dedupeTimetableAssignments($rows);
	}

	/**
	 * One lesson per subject per class — REB schools often have Primary + Examinable duplicates.
	 *
	 * @param list<array<string,mixed>> $rows
	 * @return list<array<string,mixed>>
	 */
	private function dedupeTimetableAssignments(array $rows): array
	{
		$categoryPriority = [
			'primary subjects' => 1,
			'examinable subjects' => 2,
			'non-examinable subjects' => 3,
		];
		$byKey = [];

		foreach ($rows as $row) {
			$classId = (int) ($row['class_id'] ?? 0);
			$title = strtolower(trim(preg_replace('/\s+/', ' ', (string) ($row['course_title'] ?? ''))));
			if ($classId <= 0 || $title === '') {
				continue;
			}
			$key = $classId . '|' . $title;
			$cat = strtolower(trim((string) ($row['category_title'] ?? '')));
			$prio = $categoryPriority[$cat] ?? 50;
			$lecturer = (int) ($row['lecturer'] ?? 0);
			$score = $prio * 1000 - ($lecturer > 0 ? 0 : 500);

			if (!isset($byKey[$key]) || $score < ($byKey[$key]['_score'] ?? PHP_INT_MAX)) {
				$row['_score'] = $score;
				$byKey[$key] = $row;
			}
		}

		$out = [];
		foreach ($byKey as $row) {
			unset($row['_score']);
			$out[] = $row;
		}

		usort($out, static function ($a, $b) {
			$c = strcmp((string) ($a['class_title'] ?? ''), (string) ($b['class_title'] ?? ''));
			return $c !== 0 ? $c : strcmp((string) ($a['course_title'] ?? ''), (string) ($b['course_title'] ?? ''));
		});

		return $out;
	}

	/** @return array<string,mixed> */
	private function buildGridView(
		int $schoolId,
		TimetableSchemaModel $schema,
		string $mode,
		int $entityId,
		bool $editable = false,
		bool $includeInteractiveData = true
	): array
	{
		$db = \Config\Database::connect();
		$data = $includeInteractiveData ? $this->data : [
			'academic_year' => (int) ($this->data['academic_year'] ?? 0),
			'term' => (int) ($this->data['term'] ?? 1),
			'school_name' => $this->data['school_name'] ?? '',
		];
		$year = (int) ($data['academic_year'] ?? 0);
		$term = (int) ($data['term'] ?? 1);

		if ($includeInteractiveData) {
			$schema->repairOrphanEntrySlots($schoolId);
		}

		$schedule = $db->table('timetable_schedules')
			->where('school_id', $schoolId)->where('academic_year', $year)->where('term', $term)
			->orderBy('id', 'DESC')->get(1)->getRowArray();

		$settings = $db->table('timetable_settings')->where('school_id', $schoolId)->get(1)->getRowArray();
		$dayLabels = TimetableSchemaModel::dayLabelsFromSettings($settings);
		$dayMap = TimetableSchemaModel::dayMapFromSettings($settings);
		$labelByDay = array_flip($dayMap);
		$trackKey = TimetableTrack::ALL;
		$title = '';
		$subtitle = '';
		$entries = [];

		if ($schedule && $entityId > 0) {
			$builder = $db->table('timetable_entries te')
				->select('te.*, c.title AS course_title, c.code AS course_code,
					cl.title AS class_title, cl.level AS class_level_id,
					l.title AS level_name, d.code AS dept_code, d.title AS dept_name,
					CONCAT(s.fname, " ", s.lname) AS teacher_name, ts.start_time, ts.end_time, ts.label AS slot_label')
				->join('timetable_slots ts', 'ts.id = te.slot_id', 'left')
				->join('courses c', 'c.id = te.course_id', 'left')
				->join('classes cl', 'cl.id = te.class_id', 'left')
				->join('levels l', 'l.id = cl.level', 'left')
				->join('departments d', 'd.id = cl.department', 'left')
				->join('staffs s', 's.id = te.staff_id', 'left')
				->where('te.schedule_id', (int) $schedule['id'])
				->where('te.entry_type', 'lesson')
				->where('te.day_of_week >=', 0)
				->where('te.slot_id >', 0);

			if ($mode === 'class') {
				$builder->where('te.class_id', $entityId);
				$class = $db->table('classes c')
					->select('c.title, c.level, l.title AS level_name, d.code AS dept_code, d.title AS dept_name')
					->join('levels l', 'l.id = c.level', 'left')
					->join('departments d', 'd.id = c.department', 'left')
					->where('c.id', $entityId)->get(1)->getRowArray();
				$trackKey = $schema->trackForClass($schoolId, $entityId);
				$dayLabels = TimetableSchemaModel::dayLabelsForTrack($settings, $trackKey);
				$dayMap = TimetableSchemaModel::dayMapForTrack($settings, $trackKey);
				$labelByDay = array_flip($dayMap);
				$title = TimetableClassLabel::fromRow($class ?: []);
				$subtitle = 'Class timetable';
			} else {
				$builder->where('te.staff_id', $entityId);
				$staff = $db->table('staffs')->select('fname,lname')->where('id', $entityId)->get(1)->getRowArray();
				$title = trim(($staff['fname'] ?? '') . ' ' . ($staff['lname'] ?? ''));
				$subtitle = 'Teacher timetable';
			}

			$entries = $builder->get()->getResultArray();
		}

		$dayLabels = $this->expandDayLabelsForEntries($dayLabels, $dayMap, $entries);
		$labelByDay = array_flip($dayMap);

		if ($mode === 'teacher') {
			$tracks = array_values(array_unique(array_map(
				function ($e) use ($schema, $schoolId) {
					return $schema->trackForClass($schoolId, (int) ($e['class_id'] ?? 0));
				},
				$entries
			)));
			if ($tracks === []) {
				$tracks = [TimetableTrack::ALL];
			}
			$teacherDays = [];
			foreach ($tracks as $tk) {
				foreach (TimetableSchemaModel::weekDaysForTrack($settings, (string) $tk) as $day) {
					$teacherDays[$day] = true;
				}
			}
			ksort($teacherDays);
			$allDayMap = [0 => 'Mon', 1 => 'Tue', 2 => 'Wed', 3 => 'Thu', 4 => 'Fri', 5 => 'Sat', 6 => 'Sun'];
			$dayLabels = [];
			$dayMap = [];
			foreach (array_keys($teacherDays) as $day) {
				if (!isset($allDayMap[$day])) {
					continue;
				}
				$label = $allDayMap[$day];
				$dayLabels[] = $label;
				$dayMap[$label] = (int) $day;
			}
			$labelByDay = array_flip($dayMap);
			$slots = $this->unionSlotsForTracks($schema, $schoolId, $tracks);
			$specialMap = [];
			foreach ($tracks as $tk) {
				foreach ($schema->specialTimesMap($schoolId, $tk) as $key => $special) {
					$specialMap[$key] = $special;
				}
			}
		} else {
			$slots = $schema->allSlots($schoolId, $trackKey);
			$specialMap = $schema->specialTimesMap($schoolId, $trackKey);
		}

		$grid = $this->buildGridFromSlots($slots, $dayLabels, $specialMap, $labelByDay);

		if ($entries !== []) {
			$slotMaps = $this->buildSlotIndexMaps($slots);

			foreach ($entries as $entry) {
				$si = $this->resolveSlotRowIndex($slotMaps, $entry, $slots);
				$dayLabel = $labelByDay[(int) $entry['day_of_week']] ?? null;
				if ($si === null || $dayLabel === null) {
					continue;
				}
				if (!empty($slots[$si]['is_break'])) {
					continue;
				}
				if (!empty($grid[$si]['cells'][$dayLabel]['type']) && $grid[$si]['cells'][$dayLabel]['type'] === 'special') {
					continue;
				}
				$cell = [
					'type' => 'lesson',
					'entry_id' => (int) ($entry['id'] ?? 0),
					'day' => (int) ($entry['day_of_week'] ?? 0),
					'slot_id' => (int) ($entry['slot_id'] ?? 0),
					'staff_id' => (int) ($entry['staff_id'] ?? 0),
					'class_id' => (int) ($entry['class_id'] ?? 0),
					'course' => $entry['course_title'] ?? $entry['custom_label'] ?? '',
					'code' => $entry['course_code'] ?? '',
					'teacher' => $entry['teacher_name'] ?? '',
					'class' => TimetableClassLabel::fromRow($entry),
				];
				if ($mode === 'class') {
					$cell['line2'] = $entry['teacher_name'] ?? '';
				} else {
					$cell['line2'] = TimetableClassLabel::fromRow($entry);
				}
				$grid[$si]['cells'][$dayLabel] = $cell;
			}
		}

		$data['title'] = $title ?: 'Timetable';
		$data['subtitle'] = $subtitle;
		$data['grid'] = $grid;
		$data['day_labels'] = $dayLabels;
		$data['day_map'] = $dayMap;
		$data['schedule'] = $schedule;
		$data['mode'] = $mode;
		$data['entity_id'] = $entityId;
		$data['generated_at'] = $schedule['generated_at'] ?? null;
		$data['track_key'] = $trackKey;

		if ($includeInteractiveData) {
			$data['classes'] = $this->fetchClassRows($db, $schoolId);
			$data['staffs'] = $this->fetchTimetableStaffRows(
				$db,
				$schoolId,
				$year,
				$term,
				(int) ($schedule['id'] ?? 0)
			);
		} else {
			$data['classes'] = [];
			$data['staffs'] = [];
		}

		$data['school_name'] = $this->data['school_name'] ?? '';
		$data['editable'] = $editable && !empty($schedule);
		$data['day_map'] = $dayMap;
		$data['schedule_id'] = (int) ($schedule['id'] ?? 0);
		$data['staging_entries'] = [];
		$data['conflict_entry_ids'] = [];
		$data['staging_remaining'] = 0;

		if ($includeInteractiveData && $schedule && $entityId > 0) {
			try {
				$assignments = $this->loadAssignments($schoolId, $year, $term);
				$staging = new TimetableStagingService();
				if ($mode === 'class') {
					$staging->reconcile((int) $schedule['id'], $schoolId, $assignments, $entityId, 0);
					$staging->autoPlaceStaging((int) $schedule['id'], $schoolId, $schema, $entityId, 0);
				} else {
					$staging->reconcile((int) $schedule['id'], $schoolId, $assignments, 0, $entityId);
					$staging->autoPlaceStaging((int) $schedule['id'], $schoolId, $schema, 0, $entityId);
				}
				$stagingCounts = $staging->counts(
					(int) $schedule['id'],
					$assignments,
					$mode === 'class' ? $entityId : 0,
					$mode === 'teacher' ? $entityId : 0
				);
				$data['staging_remaining'] = (int) ($stagingCounts['remaining'] ?? 0);

				$stagingBuilder = $db->table('timetable_entries te')
					->select('te.*, c.title AS course_title, c.code AS course_code,
						cl.title AS class_title, l.title AS level_name, d.code AS dept_code,
						CONCAT(s.fname, " ", s.lname) AS teacher_name')
					->join('courses c', 'c.id = te.course_id', 'left')
					->join('classes cl', 'cl.id = te.class_id', 'left')
					->join('levels l', 'l.id = cl.level', 'left')
					->join('departments d', 'd.id = cl.department', 'left')
					->join('staffs s', 's.id = te.staff_id', 'left')
					->where('te.schedule_id', (int) $schedule['id'])
					->where('te.entry_type', 'lesson')
					->where('te.day_of_week', -1)
					->where('te.slot_id', 0);
				if ($mode === 'class') {
					$stagingBuilder->where('te.class_id', $entityId);
				} else {
					$stagingBuilder->where('te.staff_id', $entityId);
				}
				$data['staging_entries'] = $stagingBuilder->get()->getResultArray();

				// Only flag conflicts that touch this class/teacher (full-school scan is too heavy for preview).
				$checker = new TimetableConflictService();
				foreach ($checker->findScheduleConflicts((int) $schedule['id'], $schoolId, $schema) as $issue) {
					$eid = (int) ($issue['entry_id'] ?? 0);
					$oid = (int) ($issue['other_id'] ?? 0);
					if ($eid > 0) {
						$data['conflict_entry_ids'][$eid] = true;
					}
					if ($oid > 0) {
						$data['conflict_entry_ids'][$oid] = true;
					}
				}
			} catch (\Throwable $e) {
				log_message('error', 'Timetable staging/conflicts skipped: {msg}', ['msg' => $e->getMessage()]);
			}
		}

		return $data;
	}

	/** @param array<string,mixed> $data @return array<string,mixed> */
	private function gridBodyViewData(array $data, bool $forPdf = false): array
	{
		return [
			'title' => $data['title'] ?? 'Timetable',
			'subtitle' => $data['subtitle'] ?? '',
			'grid' => $data['grid'] ?? [],
			'day_labels' => $data['day_labels'] ?? [],
			'day_map' => $data['day_map'] ?? [],
			'mode' => $data['mode'] ?? 'class',
			'editable' => !empty($data['editable']),
			'for_pdf' => $forPdf,
			'schedule' => $data['schedule'] ?? null,
			'schedule_id' => (int) ($data['schedule_id'] ?? 0),
			'school_name' => $data['school_name'] ?? '',
			'generated_at' => $data['generated_at'] ?? null,
			'staging_entries' => $data['staging_entries'] ?? [],
			'conflict_entry_ids' => $data['conflict_entry_ids'] ?? [],
			'staging_remaining' => (int) ($data['staging_remaining'] ?? 0),
			'letterhead' => $data['letterhead'] ?? null,
		];
	}

	/** @param list<string> $tracks @return list<array<string,mixed>> */
	private function unionSlotsForTracks(TimetableSchemaModel $schema, int $schoolId, array $tracks): array
	{
		$seen = [];
		$all = [];
		foreach ($tracks as $track) {
			foreach ($schema->allSlots($schoolId, $track) as $slot) {
				$key = ($slot['start_time'] ?? '') . '|' . ($slot['end_time'] ?? '') . '|' . ($slot['label'] ?? '');
				if (isset($seen[$key])) {
					continue;
				}
				$seen[$key] = true;
				$all[] = $slot;
			}
		}
		usort($all, static function ($a, $b) {
			$c = strcmp((string) ($a['start_time'] ?? ''), (string) ($b['start_time'] ?? ''));
			return $c !== 0 ? $c : strcmp((string) ($a['end_time'] ?? ''), (string) ($b['end_time'] ?? ''));
		});
		return $all;
	}

	/** @return list<array{slot:array,cells:array}> */
	private function buildGridFromSlots(array $slots, array $dayLabels, array $specialMap, array $labelByDay): array
	{
		$grid = [];
		foreach ($slots as $slot) {
			$row = ['slot' => $slot, 'cells' => []];
			foreach ($dayLabels as $label) {
				$row['cells'][$label] = null;
			}
			if (!empty($slot['is_break'])) {
				$grid[] = $row;
				continue;
			}
			$slotId = (int) ($slot['id'] ?? 0);
			foreach ($dayLabels as $label) {
				$dayNum = $labelByDay[$label] ?? null;
				if ($dayNum === null) {
					continue;
				}
				$row['cells'][$label] = [
					'type' => 'empty',
					'day' => $dayNum,
					'slot_id' => $slotId,
				];
			}
			$grid[] = $row;
		}

		foreach ($specialMap as $key => $special) {
			$parts = explode(':', (string) $key, 2);
			if (count($parts) < 2) {
				continue;
			}
			$dayNum = (int) $parts[0];
			$slotId = (int) $parts[1];
			$dayLabel = $labelByDay[$dayNum] ?? null;
			if ($dayLabel === null) {
				continue;
			}
			$si = null;
			foreach ($slots as $i => $slot) {
				if ((int) $slot['id'] === $slotId) {
					$si = $i;
					break;
				}
			}
			if ($si === null || !empty($slots[$si]['is_break'])) {
				continue;
			}
			$grid[$si]['cells'][$dayLabel] = [
				'type' => 'special',
				'course' => $special['label'],
				'color' => $special['color'] ?? 'yellow',
				'line2' => '',
			];
		}

		return $grid;
	}

	/** @return array<string,mixed> */
	private function letterheadData(): array
	{
		$logo = (string) ($this->data['school_logo'] ?? '');
		$logoDataUri = null;
		$logoUrl = '';
		if (strlen($logo) > 4) {
			$logoUrl = base_url('assets/images/logo/' . $logo);
			$path = FCPATH . 'assets/images/logo/' . $logo;
			if (is_file($path) && filesize($path) > 0 && filesize($path) < 400000) {
				$mime = @mime_content_type($path) ?: 'image/png';
				$logoDataUri = 'data:' . $mime . ';base64,' . base64_encode((string) file_get_contents($path));
			}
		}

		return [
			'school_name' => $this->data['school_name'] ?? '',
			'school_slogan' => $this->data['school_moto'] ?? '',
			'school_address' => $this->data['school_address'] ?? '',
			'school_phone' => $this->data['school_phone'] ?? '',
			'school_email' => $this->data['school_email'] ?? '',
			'school_website' => $this->data['school_website'] ?? '',
			'school_pobox' => $this->data['school_pobox'] ?? '',
			'logo_url' => $logoUrl,
			'logo_data_uri' => $logoDataUri,
			'academic_year_title' => $this->data['academic_year_title'] ?? '',
			'term' => (int) ($this->data['term'] ?? 1),
		];
	}

	private function inlineTimetableCss(): string
	{
		$file = FCPATH . 'assets/css/timetable.css';
		return is_file($file) ? (string) file_get_contents($file) : '';
	}

	/** @param list<array<string,mixed>> $sheets */
	private function renderPdfBody(array $sheets, ?string $coverTitle = null, bool $includeCover = true): string
	{
		$letterhead = $this->letterheadData();
		foreach ($sheets as &$sheet) {
			$sheet['for_pdf'] = true;
			$sheet['letterhead'] = $letterhead;
		}
		unset($sheet);

		if (count($sheets) === 1 && !$includeCover) {
			return view('pages/timetable/_grid_body', $sheets[0]);
		}

		return view('pages/timetable/print_bulk', [
			'sheets' => $sheets,
			'school_name' => $this->data['school_name'] ?? '',
			'cover_title' => $coverTitle,
			'include_cover' => $includeCover && count($sheets) > 1,
			'letterhead' => $letterhead,
		]);
	}

	/** @param list<array<string,mixed>> $entries */
	private function expandDayLabelsForEntries(array $dayLabels, array &$dayMap, array $entries): array
	{
		$dayNames = [0 => 'Mon', 1 => 'Tue', 2 => 'Wed', 3 => 'Thu', 4 => 'Fri', 5 => 'Sat', 6 => 'Sun'];
		foreach ($entries as $entry) {
			$d = (int) ($entry['day_of_week'] ?? -1);
			if ($d < 0 || !isset($dayNames[$d])) {
				continue;
			}
			$label = $dayNames[$d];
			if (!isset($dayMap[$label])) {
				$dayMap[$label] = $d;
			}
		}
		$ordered = [];
		foreach ($dayNames as $d => $label) {
			if (isset($dayMap[$label])) {
				$ordered[] = $label;
			}
		}
		return $ordered;
	}

	/** @param list<array<string,mixed>> $slots @return array{by_id:array<int,int>,by_time:array<string,int>} */
	private function buildSlotIndexMaps(array $slots): array
	{
		$byId = [];
		$byTime = [];
		foreach ($slots as $i => $slot) {
			$byId[(int) ($slot['id'] ?? 0)] = $i;
			if (!empty($slot['is_break'])) {
				continue;
			}
			$key = substr((string) ($slot['start_time'] ?? ''), 0, 8) . '|' . substr((string) ($slot['end_time'] ?? ''), 0, 8);
			$byTime[$key] = $i;
		}
		return ['by_id' => $byId, 'by_time' => $byTime];
	}

	/** @param array{by_id:array<int,int>,by_time:array<string,int>} $maps @param list<array<string,mixed>> $slots */
	private function resolveSlotRowIndex(array $maps, array $entry, array $slots): ?int
	{
		$id = (int) ($entry['slot_id'] ?? 0);
		if (isset($maps['by_id'][$id])) {
			return $maps['by_id'][$id];
		}
		$key = substr((string) ($entry['start_time'] ?? ''), 0, 8) . '|' . substr((string) ($entry['end_time'] ?? ''), 0, 8);
		if ($key !== '|' && isset($maps['by_time'][$key])) {
			return $maps['by_time'][$key];
		}
		return null;
	}

	/**
	 * Teachers for preview / PDF: active staff plus anyone assigned or already on the grid
	 * (placed or parked), even if their staff status is no longer 1/2.
	 *
	 * @return list<array<string,mixed>>
	 */
	private function fetchTimetableStaffRows(
		\CodeIgniter\Database\BaseConnection $db,
		int $schoolId,
		int $year = 0,
		int $term = 0,
		int $scheduleId = 0
	): array {
		$ids = [];
		$active = $db->table('staffs')
			->select('id')
			->where('school_id', $schoolId)
			->whereIn('status', [1, 2])
			->get()->getResultArray();
		foreach ($active as $row) {
			$id = (int) ($row['id'] ?? 0);
			if ($id > 0) {
				$ids[$id] = true;
			}
		}
		if ($year > 0 && $term > 0) {
			$assigned = $db->table('course_records cr')
				->select('cr.lecturer')
				->join('classes cl', 'cl.id = cr.class')
				->where('cl.school_id', $schoolId)
				->where('cr.year', $year)
				->where("find_in_set($term, cr.term) > 0", null, false)
				->where('cr.lecturer >', 0)
				->get()->getResultArray();
			foreach ($assigned as $row) {
				$id = (int) ($row['lecturer'] ?? 0);
				if ($id > 0) {
					$ids[$id] = true;
				}
			}
		}
		if ($scheduleId > 0) {
			$onGrid = $db->table('timetable_entries')
				->select('staff_id')
				->where('schedule_id', $scheduleId)
				->where('staff_id >', 0)
				->get()->getResultArray();
			foreach ($onGrid as $row) {
				$id = (int) ($row['staff_id'] ?? 0);
				if ($id > 0) {
					$ids[$id] = true;
				}
			}
		}
		if ($ids === []) {
			return [];
		}
		$idList = array_keys($ids);
		$rows = $db->table('staffs s')
			->select('s.id, s.fname, s.lname, s.post, s.status, p.title AS post_title')
			->join('posts p', 'p.id = s.post', 'left')
			->whereIn('s.id', $idList)
			->orderBy('s.fname')
			->orderBy('s.lname')
			->get()->getResultArray();
		usort($rows, static function (array $a, array $b): int {
			return strcasecmp(
				trim((string) ($a['fname'] ?? '') . ' ' . (string) ($a['lname'] ?? '')),
				trim((string) ($b['fname'] ?? '') . ' ' . (string) ($b['lname'] ?? ''))
			);
		});
		return $rows;
	}

	/** @return list<array<string,mixed>> */
	private function fetchClassRows(\CodeIgniter\Database\BaseConnection $db, int $schoolId): array
	{
		$rows = (new ClassesModel())->get_classes();
		$rows = array_values(array_filter($rows, static function (array $row): bool {
			$hay = strtolower(trim(
				(string) ($row['level_name'] ?? '') . ' '
				. (string) ($row['department_name'] ?? $row['dept_name'] ?? '') . ' '
				. (string) ($row['faculty_code'] ?? '') . ' '
				. (string) ($row['title'] ?? '')
			));
			return strpos($hay, 'holiday') === false;
		}));

		foreach ($rows as &$row) {
			if (!isset($row['dept_name']) && isset($row['department_name'])) {
				$row['dept_name'] = $row['department_name'];
			}
			$row['class_label'] = TimetableClassLabel::fromRow($row);
		}
		unset($row);

		return $rows;
	}

	private function schoolNameForId(int $schoolId): string
	{
		$sessionSchool = (int) ($this->session->get('soma_school_id') ?? 0);
		if ($sessionSchool === $schoolId && trim((string) ($this->data['school_name'] ?? '')) !== '') {
			return (string) $this->data['school_name'];
		}
		$row = \Config\Database::connect()->table('schools')->select('name')->where('id', $schoolId)->get(1)->getRowArray();
		return trim((string) ($row['name'] ?? '')) ?: 'School';
	}

	private function unplacedPdfDir(): string
	{
		$dir = WRITEPATH . 'uploads/timetables';
		if (!is_dir($dir)) {
			@mkdir($dir, 0755, true);
		}
		return $dir;
	}

	private function unplacedPdfPath(string $filename): string
	{
		$filename = basename($filename);
		return $this->unplacedPdfDir() . DIRECTORY_SEPARATOR . $filename;
	}

	/**
	 * @param list<array<string,mixed>> $assignments
	 * @return array{report:array<string,mixed>,full:array<string,mixed>,pdf:?string}
	 */
	private function buildUnplacedSummary(
		int $scheduleId,
		int $schoolId,
		TimetableSchemaModel $schema,
		array $assignments,
		string $phase,
		int $year,
		int $term
	): array {
		foreach ($assignments as $i => $row) {
			if (empty($row['_track_key']) && empty($row['track_key'])) {
				$assignments[$i]['_track_key'] = $schema->trackForClass($schoolId, (int) ($row['class_id'] ?? 0));
			}
		}
		$full = (new TimetableUnplacedReport())->build(
			$scheduleId,
			$schoolId,
			$schema,
			$assignments,
			$phase,
			$this->schoolNameForId($schoolId)
		);
		// Build the PDF on download so generation is not blocked by wkhtmltopdf.
		$pdf = null;
		$courses = [];
		foreach (array_slice($full['courses'] ?? [], 0, 80) as $row) {
			$courses[] = [
				'level' => $row['level'] ?? '',
				'class_id' => (int) ($row['class_id'] ?? 0),
				'class' => $row['class'] ?? '',
				'course' => $row['course'] ?? '',
				'teacher' => $row['teacher'] ?? '',
				'needed' => (int) ($row['needed'] ?? 0),
				'placed' => (int) ($row['placed'] ?? 0),
				'missed' => (int) ($row['missed'] ?? 0),
				'suggestions' => array_slice($row['suggestions'] ?? [], 0, 4),
			];
		}
		$byClass = [];
		foreach (array_slice($full['by_class'] ?? [], 0, 40) as $group) {
			$items = [];
			foreach (array_slice($group['items'] ?? [], 0, 20) as $item) {
				$items[] = [
					'course' => $item['course'] ?? '',
					'teacher' => $item['teacher'] ?? '',
					'needed' => (int) ($item['needed'] ?? 0),
					'placed' => (int) ($item['placed'] ?? 0),
					'missed' => (int) ($item['missed'] ?? 0),
					'suggestions' => array_slice($item['suggestions'] ?? [], 0, 4),
				];
			}
			$byClass[] = [
				'class' => $group['class'] ?? 'Class',
				'class_id' => (int) ($group['class_id'] ?? 0),
				'level' => $group['level'] ?? '',
				'missed' => (int) ($group['missed'] ?? 0),
				'courses' => (int) ($group['courses'] ?? count($items)),
				'items' => $items,
			];
		}
		return [
			'report' => [
				'missed_periods' => (int) ($full['missed_periods'] ?? 0),
				'missed_courses' => (int) ($full['missed_courses'] ?? 0),
				'missed_teachers' => (int) ($full['missed_teachers'] ?? 0),
				'missed_classes' => (int) ($full['missed_classes'] ?? count($byClass)),
				'phase_label' => (string) ($full['phase_label'] ?? ''),
				'courses' => $courses,
				'by_class' => $byClass,
			],
			'full' => $full,
			'pdf' => $pdf,
		];
	}

	/** @param array<string,mixed> $report */
	private function saveUnplacedPdf(array $report, int $schoolId, int $year, int $term): ?string
	{
		$html = $this->renderUnplacedPdfHtml($report, $year, $term);
		$filename = 'Unplaced_periods_' . $schoolId . '_' . $year . '_T' . $term . '_' . date('Ymd_His') . '.pdf';
		try {
			$wk = new Wkhtmltopdf(['path' => $this->unplacedPdfDir()]);
			$wk->setTitle('Unplaced periods');
			$wk->setHtml($html);
			$wk->setOrientation(Wkhtmltopdf::ORIENTATION_LANDSCAPE);
			$wk->setPageSize(Wkhtmltopdf::SIZE_A4);
			$wk->setMargins(['top' => 10, 'bottom' => 10, 'left' => 10, 'right' => 10]);
			$wk->setOptions(['encoding' => 'UTF-8']);
			$wk->output(Wkhtmltopdf::MODE_SAVE, $filename);
			return is_file($this->unplacedPdfPath($filename)) ? $filename : null;
		} catch (\Throwable $e) {
			log_message('error', 'Unplaced timetable PDF failed: {msg}', ['msg' => $e->getMessage()]);
			$fallback = str_replace('.pdf', '.html', $filename);
			@file_put_contents($this->unplacedPdfPath($fallback), $html);
			return is_file($this->unplacedPdfPath($fallback)) ? $fallback : null;
		}
	}

	/** @param array<string,mixed> $report */
	private function renderUnplacedPdfHtml(array $report, int $year, int $term): string
	{
		return view('pages/timetable/_pdf_unplaced', [
			'doc_title' => 'Unplaced periods',
			'school_name' => (string) ($report['school'] ?? $this->schoolNameForId((int) ($this->session->get('soma_school_id') ?? 0))),
			'phase_label' => (string) ($report['phase_label'] ?? 'All levels'),
			'academic_year' => (string) ($this->data['academic_year_title'] ?? $year),
			'term' => $term,
			'generated_at' => (string) ($report['generated_at'] ?? date('Y-m-d H:i')),
			'missed_periods' => (int) ($report['missed_periods'] ?? 0),
			'missed_courses' => (int) ($report['missed_courses'] ?? 0),
			'missed_teachers' => (int) ($report['missed_teachers'] ?? 0),
			'courses' => $report['courses'] ?? [],
			'teachers' => $report['teachers'] ?? [],
			'by_class' => $report['by_class'] ?? [],
		]);
	}

	/**
	 * @param list<array<string,mixed>> $sheets
	 * @return \CodeIgniter\HTTP\Response|string
	 */
	private function outputTimetablePdf(array $sheets, string $filenamePrefix, ?string $coverTitle = null, bool $includeCover = true)
	{
		if ($sheets === []) {
			$this->session->setFlashdata('error', 'No timetable generated yet.');
			header('Location: ' . base_url('timetable/dashboard'));
			exit;
		}

		try {
			$body = $this->renderPdfBody($sheets, $coverTitle, $includeCover);
			$html = view('pages/timetable/_pdf_document', [
				'doc_title' => $filenamePrefix,
				'inline_css' => $this->inlineTimetableCss(),
				'body' => $body,
			]);
		} catch (\Throwable $e) {
			log_message('error', 'Timetable PDF HTML failed: {msg}', ['msg' => $e->getMessage()]);
			throw $e;
		}

		$dir = WRITEPATH . 'uploads/timetables';
		if (!is_dir($dir)) {
			@mkdir($dir, 0755, true);
		}
		if (!is_dir($dir) || !is_writable($dir)) {
			$dir = rtrim(sys_get_temp_dir(), '/\\');
		}

		$filename = preg_replace('/[^A-Za-z0-9_\-]+/', '_', $filenamePrefix) . '_' . date('Y-m-d') . '.pdf';

		try {
			$wk = new Wkhtmltopdf(['path' => $dir]);
			$wk->setTitle($filenamePrefix);
			$wk->setHtml($html);
			$wk->setOrientation(Wkhtmltopdf::ORIENTATION_LANDSCAPE);
			$wk->setPageSize(Wkhtmltopdf::SIZE_A4);
			$wk->setMargins(['top' => 8, 'bottom' => 8, 'left' => 8, 'right' => 8]);
			$wk->setOptions(['encoding' => 'UTF-8']);
			$pdf = $wk->output(Wkhtmltopdf::MODE_STRING, $filename);
			if (!is_string($pdf) || strncmp($pdf, '%PDF', 4) !== 0) {
				throw new \RuntimeException('PDF converter returned empty output.');
			}
			return $this->response
				->setHeader('Content-Type', 'application/pdf')
				->setHeader('Content-Disposition', 'attachment; filename="' . $filename . '"')
				->setHeader('Cache-Control', 'private, max-age=0, must-revalidate')
				->setBody($pdf);
		} catch (\Throwable $e) {
			log_message('error', 'Timetable PDF convert failed: {msg}', ['msg' => $e->getMessage()]);
			return $this->response
				->setHeader('Content-Type', 'text/html; charset=UTF-8')
				->setHeader('Content-Disposition', 'inline; filename="' . preg_replace('/\.pdf$/', '.html', $filename) . '"')
				->setBody($html . '<script>window.onload=function(){window.print();}</script>');
		}
	}
}
