<?php

namespace App\Services\Timetable;

/**
 * School-defined timetable rules (last hour, teacher days/windows).
 */
class TimetableCriteriaStore
{
	public function ensureTable(): void
	{
		$db = \Config\Database::connect();
		if (!$db->tableExists('timetable_custom_criteria')) {
			$db->query("CREATE TABLE IF NOT EXISTS `timetable_custom_criteria` (
				`id` int(11) NOT NULL AUTO_INCREMENT,
				`school_id` int(11) NOT NULL,
				`rule_type` varchar(40) NOT NULL,
				`teacher_id` int(11) NOT NULL DEFAULT 0,
				`course_id` int(11) NOT NULL DEFAULT 0,
				`class_id` int(11) NOT NULL DEFAULT 0,
				`class_ids` varchar(255) DEFAULT NULL,
				`days` varchar(64) DEFAULT NULL,
				`start_time` varchar(8) DEFAULT NULL,
				`end_time` varchar(8) DEFAULT NULL,
				`note` varchar(255) DEFAULT NULL,
				`enabled` tinyint(1) NOT NULL DEFAULT 1,
				`is_locked` tinyint(1) NOT NULL DEFAULT 0,
				`source` varchar(20) DEFAULT 'custom',
				`created_at` datetime DEFAULT CURRENT_TIMESTAMP,
				PRIMARY KEY (`id`),
				KEY `school_id` (`school_id`)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
		}
		$this->ensureExtraColumns();
	}

	private function ensureExtraColumns(): void
	{
		$db = \Config\Database::connect();
		if (!$db->tableExists('timetable_custom_criteria')) {
			return;
		}
		$fields = $db->getFieldNames('timetable_custom_criteria');
		$adds = [
			'class_ids' => "ALTER TABLE `timetable_custom_criteria` ADD COLUMN `class_ids` varchar(255) DEFAULT NULL AFTER `class_id`",
			'is_locked' => "ALTER TABLE `timetable_custom_criteria` ADD COLUMN `is_locked` tinyint(1) NOT NULL DEFAULT 0 AFTER `enabled`",
			'source' => "ALTER TABLE `timetable_custom_criteria` ADD COLUMN `source` varchar(20) DEFAULT 'custom' AFTER `is_locked`",
		];
		foreach ($adds as $name => $sql) {
			if (in_array($name, $fields, true)) {
				continue;
			}
			try {
				$db->query($sql);
			} catch (\Throwable $e) {
				// column may exist
			}
		}
	}

	/** @return list<array<string,mixed>> */
	public function listForSchool(int $schoolId, bool $enabledOnly = false): array
	{
		$this->ensureTable();
		if ($schoolId <= 0) {
			return [];
		}
		$b = \Config\Database::connect()->table('timetable_custom_criteria')
			->where('school_id', $schoolId)
			->orderBy('id', 'DESC');
		if ($enabledOnly) {
			$b->where('enabled', 1);
		}
		return $b->get()->getResultArray();
	}

	/** @param array<string,mixed> $input */
	public function save(int $schoolId, array $input): array
	{
		$this->ensureTable();
		$db = \Config\Database::connect();
		$id = (int) ($input['id'] ?? 0);
		$type = trim((string) ($input['rule_type'] ?? ''));
		$allowed = ['last_hour', 'teacher_window', 'teacher_days', 'morning', 'teach_sunday', 'after_lessons', 'combine_classes'];
		if (!in_array($type, $allowed, true)) {
			return ['error' => 'Choose a valid rule type.'];
		}
		$days = $input['days'] ?? [];
		if (is_string($days)) {
			$days = array_filter(array_map('intval', explode(',', $days)));
		}
		if (!is_array($days)) {
			$days = [];
		}
		$days = array_values(array_unique(array_map('intval', $days)));
		$classIds = $this->decodeClassIds($input['class_ids'] ?? null);
		$row = [
			'school_id' => $schoolId,
			'rule_type' => $type,
			'teacher_id' => (int) ($input['teacher_id'] ?? 0),
			'course_id' => (int) ($input['course_id'] ?? 0),
			'class_id' => (int) ($input['class_id'] ?? 0),
			'days' => json_encode($days),
			'start_time' => $this->normTime($input['start_time'] ?? ''),
			'end_time' => $this->normTime($input['end_time'] ?? ''),
			'note' => substr(trim((string) ($input['note'] ?? '')), 0, 255),
			'enabled' => !empty($input['enabled']) ? 1 : 1,
		];
		if ($db->fieldExists('class_ids', 'timetable_custom_criteria')) {
			$row['class_ids'] = $classIds !== [] ? json_encode($classIds) : null;
		}
		if ($id <= 0 && $db->fieldExists('source', 'timetable_custom_criteria')) {
			$row['source'] = 'custom';
			$row['is_locked'] = 0;
		}
		if ($type === 'teacher_window' && ((int) $row['teacher_id'] <= 0 || $days === [] || $row['start_time'] === '' || $row['end_time'] === '')) {
			return ['error' => 'Teacher window needs a teacher, at least one day, and a time range.'];
		}
		if ($type === 'teacher_days' && ((int) $row['teacher_id'] <= 0 || $days === [])) {
			return ['error' => 'Teacher days needs a teacher and the allowed days.'];
		}
		if ($type === 'last_hour' && (int) $row['course_id'] <= 0 && (int) $row['teacher_id'] <= 0) {
			return ['error' => 'Last hour needs a course or a teacher.'];
		}
		if ($type === 'after_lessons') {
			if ((int) $row['course_id'] <= 0 && (int) $row['teacher_id'] <= 0 && (int) $row['class_id'] <= 0) {
				return ['error' => 'After 15:40 needs a course, teacher, or class.'];
			}
			$row['start_time'] = '';
			$row['end_time'] = '';
		}
		if ($type === 'combine_classes') {
			if (count($classIds) < 2) {
				return ['error' => 'Combine classes needs at least two classes (and usually a course).'];
			}
			$row['days'] = json_encode($classIds);
			$row['start_time'] = '';
			$row['end_time'] = '';
			if ((int) $row['class_id'] <= 0) {
				$row['class_id'] = $classIds[0];
			}
		}
		if ($type === 'teach_sunday') {
			if ((int) $row['course_id'] <= 0 && (int) $row['teacher_id'] <= 0 && (int) $row['class_id'] <= 0) {
				return ['error' => 'Teach on Sunday needs a course, teacher, or class. Save it before generating.'];
			}
			// Sunday uses the school's existing bell periods — never invent a new period here.
			$row['start_time'] = '';
			$row['end_time'] = '';
			$row['days'] = json_encode([6]);
		}
		if ($id > 0) {
			$db->table('timetable_custom_criteria')->where('id', $id)->where('school_id', $schoolId)->update($row);
			return ['success' => true, 'id' => $id];
		}
		$db->table('timetable_custom_criteria')->insert($row);
		return ['success' => true, 'id' => (int) $db->insertID()];
	}

	public function delete(int $schoolId, int $id): bool
	{
		$result = $this->deleteDetailed($schoolId, $id);
		return !empty($result['success']);
	}

	/** @return array{success?:bool,error?:string} */
	public function deleteDetailed(int $schoolId, int $id): array
	{
		$this->ensureTable();
		if ($schoolId <= 0 || $id <= 0) {
			return ['error' => 'Could not delete rule.'];
		}
		$db = \Config\Database::connect();
		$existing = $db->table('timetable_custom_criteria')
			->where('school_id', $schoolId)->where('id', $id)->get(1)->getRowArray();
		if (!$existing) {
			return ['error' => 'Rule not found.'];
		}
		if (!empty($existing['is_locked']) || (string) ($existing['source'] ?? '') === 'document') {
			return ['error' => 'Document criteria stay locked so generate cannot drop them.'];
		}
		$db->table('timetable_custom_criteria')->where('school_id', $schoolId)->where('id', $id)->delete();
		return ['success' => true];
	}

	/** @return list<int> */
	private function decodeClassIds($raw): array
	{
		if (is_string($raw)) {
			$decoded = json_decode($raw, true);
			$raw = is_array($decoded) ? $decoded : explode(',', $raw);
		}
		if (!is_array($raw)) {
			return [];
		}
		$ids = [];
		foreach ($raw as $id) {
			$id = (int) $id;
			if ($id > 0) {
				$ids[] = $id;
			}
		}
		return array_values(array_unique($ids));
	}

	private function normTime($value): string
	{
		$t = trim((string) $value);
		if ($t === '') {
			return '';
		}
		if (preg_match('/^(\d{1,2}):(\d{2})/', $t, $m)) {
			return sprintf('%02d:%02d', (int) $m[1], (int) $m[2]);
		}
		return '';
	}
}
