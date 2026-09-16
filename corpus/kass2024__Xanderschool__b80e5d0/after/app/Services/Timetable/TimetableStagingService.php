<?php

namespace App\Services\Timetable;

/**
 * Parking-lot staging: one DB row per weekly period still not on the grid.
 */
class TimetableStagingService
{
	/** @var array<string,array<string,mixed>> */
	private $assignmentMeta = [];

	/** @var array<string,mixed>|null */
	private $timetableSettings = null;

	/** @var SecondaryTimetableCriteria|null */
	private $secondaryCriteria = null;

	/** @return string */
	private function assignmentKey(int $courseRecordId, int $classId, int $courseId, int $staffId): string
	{
		if ($courseRecordId > 0) {
			return 'cr:' . $courseRecordId;
		}

		return 'c:' . $classId . ':' . $courseId . ':' . $staffId;
	}

	/** @param array<string,mixed> $entry */
	private function entryIsLocked(array $entry): bool
	{
		return (int) ($entry['is_locked'] ?? 0) === 1;
	}

	/**
	 * @param array<string,mixed> $assignment
	 */
	private function keyFromAssignment(array $assignment): string
	{
		return $this->assignmentKey(
			(int) ($assignment['course_record_id'] ?? 0),
			(int) ($assignment['class_id'] ?? 0),
			(int) ($assignment['course_id'] ?? 0),
			(int) ($assignment['lecturer'] ?? 0)
		);
	}

	/**
	 * @param array<string,mixed> $entry
	 */
	private function keyFromEntry(array $entry): string
	{
		return $this->assignmentKey(
			(int) ($entry['course_record_id'] ?? 0),
			(int) ($entry['class_id'] ?? 0),
			(int) ($entry['course_id'] ?? 0),
			(int) ($entry['staff_id'] ?? 0)
		);
	}

	/**
	 * Create staging rows (day=-1, slot=0) for assignment periods not yet scheduled.
	 *
	 * @param list<array<string,mixed>> $assignments
	 */
	public function reconcile(
		int $scheduleId,
		int $schoolId,
		array $assignments,
		int $filterClassId = 0,
		int $filterStaffId = 0
	): int {
		if ($scheduleId <= 0 || $schoolId <= 0 || $assignments === []) {
			return 0;
		}

		$db = \Config\Database::connect();
		$filtered = array_values(array_filter($assignments, static function (array $row) use ($filterClassId, $filterStaffId): bool {
			if ($filterClassId > 0 && (int) ($row['class_id'] ?? 0) !== $filterClassId) {
				return false;
			}
			if ($filterStaffId > 0 && (int) ($row['lecturer'] ?? 0) !== $filterStaffId) {
				return false;
			}

			return true;
		}));

		if ($filtered === []) {
			return 0;
		}

		$entries = $db->table('timetable_entries')
			->where('schedule_id', $scheduleId)
			->where('school_id', $schoolId)
			->where('entry_type', 'lesson')
			->get()->getResultArray();

		$scheduled = [];
		$staged = [];
		/** @var array<string,list<int>> */
		$scheduledIds = [];
		/** @var array<string,list<int>> */
		$stagedIds = [];
		foreach ($entries as $entry) {
			$key = $this->keyFromEntry($entry);
			$day = (int) ($entry['day_of_week'] ?? 0);
			$slotId = (int) ($entry['slot_id'] ?? 0);
			$id = (int) ($entry['id'] ?? 0);
			if ($day >= 0 && $slotId > 0) {
				$scheduled[$key] = ($scheduled[$key] ?? 0) + 1;
				if ($id > 0) {
					$scheduledIds[$key][] = $id;
				}
			} elseif ($day === -1 && $slotId === 0) {
				$staged[$key] = ($staged[$key] ?? 0) + 1;
				if ($id > 0) {
					$stagedIds[$key][] = $id;
				}
			}
		}

		$created = 0;
		foreach ($filtered as $assignment) {
			$key = $this->keyFromAssignment($assignment);
			$needed = TimetableGeneratorService::weeklyHoursFromCourse($assignment);
			$haveScheduled = (int) ($scheduled[$key] ?? 0);
			$haveStaged = (int) ($staged[$key] ?? 0);

			// Never keep more grid periods than the course credit / weekly allocation.
			if ($haveScheduled > $needed && !empty($scheduledIds[$key])) {
				$surplus = $haveScheduled - $needed;
				$toDelete = array_slice($scheduledIds[$key], -$surplus);
				if ($toDelete !== []) {
					$db->table('timetable_entries')->whereIn('id', $toDelete)->delete();
					$haveScheduled = $needed;
					$scheduled[$key] = $haveScheduled;
				}
			}

			$allowedStaged = max(0, $needed - $haveScheduled);
			if ($haveStaged > $allowedStaged && !empty($stagedIds[$key])) {
				$surplus = $haveStaged - $allowedStaged;
				$toDelete = array_slice($stagedIds[$key], -$surplus);
				if ($toDelete !== []) {
					$db->table('timetable_entries')->whereIn('id', $toDelete)->delete();
					$haveStaged = $allowedStaged;
					$staged[$key] = $haveStaged;
				}
			}

			$have = $haveScheduled + $haveStaged;
			$deficit = $needed - $have;
			if ($deficit <= 0) {
				continue;
			}

			for ($i = 0; $i < $deficit; $i++) {
				$db->table('timetable_entries')->insert([
					'schedule_id' => $scheduleId,
					'school_id' => $schoolId,
					'class_id' => (int) ($assignment['class_id'] ?? 0),
					'staff_id' => (int) ($assignment['lecturer'] ?? 0),
					'course_id' => (int) ($assignment['course_id'] ?? 0),
					'course_record_id' => (int) ($assignment['course_record_id'] ?? 0) ?: null,
					'day_of_week' => -1,
					'slot_id' => 0,
					'entry_type' => 'lesson',
				]);
				$created++;
			}
		}

		return $created;
	}

	/**
	 * @param list<array<string,mixed>> $assignments
	 * @return array{scheduled:int,staging:int,remaining:int}
	 */
	public function counts(int $scheduleId, array $assignments, int $filterClassId = 0, int $filterStaffId = 0): array
	{
		$db = \Config\Database::connect();
		$needed = 0;
		foreach ($assignments as $assignment) {
			if ($filterClassId > 0 && (int) ($assignment['class_id'] ?? 0) !== $filterClassId) {
				continue;
			}
			if ($filterStaffId > 0 && (int) ($assignment['lecturer'] ?? 0) !== $filterStaffId) {
				continue;
			}
			$needed += TimetableGeneratorService::weeklyHoursFromCourse($assignment);
		}

		$scheduled = (int) $db->table('timetable_entries')
			->where('schedule_id', $scheduleId)
			->where('entry_type', 'lesson')
			->where('day_of_week >=', 0)
			->where('slot_id >', 0)
			->countAllResults();

		if ($filterClassId > 0) {
			$scheduled = (int) $db->table('timetable_entries')
				->where('schedule_id', $scheduleId)
				->where('class_id', $filterClassId)
				->where('entry_type', 'lesson')
				->where('day_of_week >=', 0)
				->where('slot_id >', 0)
				->countAllResults();
		} elseif ($filterStaffId > 0) {
			$scheduled = (int) $db->table('timetable_entries')
				->where('schedule_id', $scheduleId)
				->where('staff_id', $filterStaffId)
				->where('entry_type', 'lesson')
				->where('day_of_week >=', 0)
				->where('slot_id >', 0)
				->countAllResults();
		}

		$staging = (int) $db->table('timetable_entries')
			->where('schedule_id', $scheduleId)
			->where('entry_type', 'lesson')
			->where('day_of_week', -1)
			->where('slot_id', 0)
			->countAllResults();

		return [
			'scheduled' => $scheduled,
			'staging' => $staging,
			'remaining' => max(0, $needed - $scheduled),
		];
	}

	/**
	 * Move parking-lot lessons onto free grid cells (greedy placement).
	 */
	public function autoPlaceStaging(
		int $scheduleId,
		int $schoolId,
		\App\Models\TimetableSchemaModel $schema,
		int $filterClassId = 0,
		int $filterStaffId = 0,
		bool $allowRelocate = true
	): int {
		if ($scheduleId <= 0 || $schoolId <= 0) {
			return 0;
		}

		$db = \Config\Database::connect();
		$settings = $db->table('timetable_settings')->where('school_id', $schoolId)->get(1)->getRowArray();
		$this->timetableSettings = $settings;
		$days = \App\Models\TimetableSchemaModel::weekDaysFromSettings($settings);
		$this->assignmentMeta = $this->loadAssignmentMeta($scheduleId, $schoolId);
		$this->secondaryCriteria = new SecondaryTimetableCriteria();
		$this->secondaryCriteria->hydrateFromAssignments(array_values($this->assignmentMeta));
		$this->secondaryCriteria->hydrateCustomRules((new TimetableCriteriaStore())->listForSchool($schoolId, true));

		$builder = $db->table('timetable_entries')
			->where('schedule_id', $scheduleId)
			->where('school_id', $schoolId)
			->where('entry_type', 'lesson')
			->where('day_of_week', -1)
			->where('slot_id', 0);
		if ($filterClassId > 0) {
			$builder->where('class_id', $filterClassId);
		}
		if ($filterStaffId > 0) {
			$builder->where('staff_id', $filterStaffId);
		}
		$parking = $builder->orderBy('id')->get()->getResultArray();
		if ($parking === []) {
			return 0;
		}

		$scheduled = $db->table('timetable_entries te')
			->select('te.*, ts.start_time, ts.end_time')
			->join('timetable_slots ts', 'ts.id = te.slot_id', 'left')
			->where('schedule_id', $scheduleId)
			->where('te.entry_type', 'lesson')
			->where('te.day_of_week >=', 0)
			->where('te.slot_id >', 0)
			->get()->getResultArray();

		$state = $this->buildScheduleState($scheduled);
		/** @var array<string,int> */
		$scheduledByKey = [];
		foreach ($scheduled as $row) {
			$key = $this->keyFromEntry($row);
			$scheduledByKey[$key] = ($scheduledByKey[$key] ?? 0) + 1;
		}

		usort($parking, function (array $a, array $b) use ($days, $schema, $schoolId, $state): int {
			return $this->countDirectCandidates($a, $days, $schema, $schoolId, $state)
				<=> $this->countDirectCandidates($b, $days, $schema, $schoolId, $state);
		});

		$placed = 0;
		foreach ($parking as $entry) {
			$key = $this->keyFromEntry($entry);
			$meta = $this->metaForEntry($entry);
			$needed = TimetableGeneratorService::weeklyHoursFromCourse($meta);
			$have = (int) ($scheduledByKey[$key] ?? 0);
			if ($needed > 0 && $have >= $needed) {
				// Drop surplus parking — already at allocated weekly periods.
				$db->table('timetable_entries')->where('id', (int) $entry['id'])->delete();
				continue;
			}

			$found = $this->findBestDirectPlacement($entry, $days, $schema, $schoolId, $state);
			if ($found === null && $allowRelocate) {
				$found = $this->placeByRelocatingOneBlocker($db, $entry, $days, $schema, $schoolId, $state);
			}
			if ($found === null) {
				continue;
			}

			$db->table('timetable_entries')->where('id', (int) $entry['id'])->update([
				'day_of_week' => $found['day'],
				'slot_id' => $found['slot_id'],
			]);
			$entry['day_of_week'] = $found['day'];
			$entry['slot_id'] = $found['slot_id'];
			$this->addScheduledEntry($state, $entry);
			$scheduledByKey[$key] = $have + 1;
			$placed++;
		}

		return $placed;
	}

	/**
	 * Remove any class-slot or teacher-slot collisions, then try to place the extra rows legally.
	 *
	 * @return array{moved_to_parking:int,replaced:int,remaining_conflicts:int}
	 */
	public function normalizeScheduleConflicts(
		int $scheduleId,
		int $schoolId,
		\App\Models\TimetableSchemaModel $schema,
		int $filterClassId = 0,
		int $filterStaffId = 0,
		int $maxPasses = 4
	): array {
		$db = \Config\Database::connect();
		$totalMoved = 0;
		$totalReplaced = 0;
		$remaining = 0;

		for ($pass = 0; $pass < $maxPasses; $pass++) {
			$scheduled = $this->scheduledEntries($scheduleId, $schoolId, $filterClassId, $filterStaffId);
			$idsToParking = $this->collectConflictEntryIds($scheduled);
			$remaining = count($idsToParking);
			if ($idsToParking === []) {
				$remaining = 0;
				break;
			}

			$park = $db->table('timetable_entries')->whereIn('id', $idsToParking);
			if ($db->fieldExists('is_locked', 'timetable_entries')) {
				$park->groupStart()->where('is_locked', 0)->orWhere('is_locked IS NULL', null, false)->groupEnd();
			}
			$park->update([
				'day_of_week' => -1,
				'slot_id' => 0,
			]);
			$totalMoved += count($idsToParking);
			// Place only into free cells — never relocate a legal lesson to force a fit.
			$totalReplaced += $this->autoPlaceStaging($scheduleId, $schoolId, $schema, $filterClassId, $filterStaffId, false);
		}

		$totalMoved += $this->parkAllConflicts($scheduleId, $schoolId, $filterClassId, $filterStaffId);
		$remaining = count($this->collectConflictEntryIds(
			$this->scheduledEntries($scheduleId, $schoolId, $filterClassId, $filterStaffId)
		));

		return [
			'moved_to_parking' => $totalMoved,
			'replaced' => $totalReplaced,
			'remaining_conflicts' => $remaining,
		];
	}

	/**
	 * Move parked or afternoon lessons into empty morning teaching slots for every class.
	 */
	public function fillMorningGaps(
		int $scheduleId,
		int $schoolId,
		\App\Models\TimetableSchemaModel $schema
	): int {
		if ($scheduleId <= 0 || $schoolId <= 0) {
			return 0;
		}
		$db = \Config\Database::connect();
		$settings = $db->table('timetable_settings')->where('school_id', $schoolId)->get(1)->getRowArray();
		$this->timetableSettings = $settings;
		$this->assignmentMeta = $this->loadAssignmentMeta($scheduleId, $schoolId);
		$this->secondaryCriteria = new SecondaryTimetableCriteria();
		$this->secondaryCriteria->hydrateFromAssignments(array_values($this->assignmentMeta));
		$this->secondaryCriteria->hydrateCustomRules((new TimetableCriteriaStore())->listForSchool($schoolId, true));

		$scheduled = $this->scheduledEntries($scheduleId, $schoolId);
		$state = $this->buildScheduleState($scheduled);
		$parking = $db->table('timetable_entries')
			->where('schedule_id', $scheduleId)
			->where('school_id', $schoolId)
			->where('entry_type', 'lesson')
			->where('day_of_week', -1)
			->where('slot_id', 0)
			->orderBy('id')
			->get()->getResultArray();

		$parkedByClass = [];
		foreach ($parking as $row) {
			$parkedByClass[(int) ($row['class_id'] ?? 0)][] = $row;
		}
		$placedByClass = [];
		foreach ($scheduled as $row) {
			$placedByClass[(int) ($row['class_id'] ?? 0)][] = $row;
		}

		$filled = 0;
		$classIds = array_unique(array_merge(array_keys($parkedByClass), array_keys($placedByClass)));
		foreach ($classIds as $classId) {
			if ($classId <= 0) {
				continue;
			}
			$trackKey = $schema->trackForClass($schoolId, $classId);
			$days = \App\Models\TimetableSchemaModel::weekDaysForTrack($settings, $trackKey);
			$slots = array_values(array_filter(
				$schema->teachingSlots($schoolId, $trackKey),
				static fn ($s) => empty($s['is_break'])
			));
			$blocked = $schema->specialTimesMap($schoolId, $trackKey);
			foreach ($days as $day) {
				foreach ($slots as $slot) {
					$slotId = (int) ($slot['id'] ?? 0);
					if ($slotId <= 0 || !TimetableGeneratorService::isMorningClock((string) ($slot['start_time'] ?? ''))) {
						continue;
					}
					if (!empty($blocked[$day . ':' . $slotId])) {
						continue;
					}
					if (!empty($state['class_busy'][$classId . ':' . $day . ':' . $slotId])) {
						continue;
					}

					$moved = $this->fillOneMorningSlot(
						$db,
						(int) $day,
						$slot,
						$parkedByClass[$classId] ?? [],
						$placedByClass[$classId] ?? [],
						$state
					);
					if ($moved === null) {
						continue;
					}
					$filled++;
					if (($moved['from'] ?? '') === 'parking') {
						$parkedByClass[$classId] = array_values(array_filter(
							$parkedByClass[$classId] ?? [],
							static fn (array $row): bool => (int) ($row['id'] ?? 0) !== (int) $moved['id']
						));
						$placedByClass[$classId][] = $moved['entry'];
					} else {
						foreach ($placedByClass[$classId] as $i => $row) {
							if ((int) ($row['id'] ?? 0) === (int) $moved['id']) {
								$placedByClass[$classId][$i] = $moved['entry'];
								break;
							}
						}
					}
				}
			}
		}

		return $filled;
	}

	/**
	 * Place remaining Manage Course periods into any legal free slot (morning or afternoon).
	 */
	public function fillWeeklyPeriodGaps(
		int $scheduleId,
		int $schoolId,
		\App\Models\TimetableSchemaModel $schema
	): int {
		if ($scheduleId <= 0 || $schoolId <= 0) {
			return 0;
		}
		$db = \Config\Database::connect();
		$settings = $db->table('timetable_settings')->where('school_id', $schoolId)->get(1)->getRowArray();
		$this->timetableSettings = $settings;
		$this->assignmentMeta = $this->loadAssignmentMeta($scheduleId, $schoolId);
		$this->secondaryCriteria = new SecondaryTimetableCriteria();
		$this->secondaryCriteria->hydrateFromAssignments(array_values($this->assignmentMeta));
		$this->secondaryCriteria->hydrateCustomRules((new TimetableCriteriaStore())->listForSchool($schoolId, true));

		$days = \App\Models\TimetableSchemaModel::weekDaysFromSettings($settings);
		$scheduled = $this->scheduledEntries($scheduleId, $schoolId);
		$state = $this->buildScheduleState($scheduled);
		$parking = $db->table('timetable_entries')
			->where('schedule_id', $scheduleId)
			->where('school_id', $schoolId)
			->where('entry_type', 'lesson')
			->where('day_of_week', -1)
			->where('slot_id', 0)
			->orderBy('id')
			->get()->getResultArray();
		if ($parking === []) {
			return 0;
		}

		$scheduledByKey = [];
		foreach ($scheduled as $row) {
			$key = $this->keyFromEntry($row);
			$scheduledByKey[$key] = ($scheduledByKey[$key] ?? 0) + 1;
		}

		$placed = 0;
		foreach ($parking as $entry) {
			$key = $this->keyFromEntry($entry);
			$meta = $this->metaForEntry($entry);
			$needed = TimetableGeneratorService::weeklyHoursFromCourse($meta);
			$have = (int) ($scheduledByKey[$key] ?? 0);
			if ($needed > 0 && $have >= $needed) {
				continue;
			}
			$found = $this->findBestDirectPlacement($entry, $days, $schema, $schoolId, $state, true);
			if ($found === null) {
				continue;
			}
			$db->table('timetable_entries')->where('id', (int) $entry['id'])->update([
				'day_of_week' => $found['day'],
				'slot_id' => $found['slot_id'],
			]);
			$entry['day_of_week'] = $found['day'];
			$entry['slot_id'] = $found['slot_id'];
			$this->addScheduledEntry($state, $entry);
			$scheduledByKey[$key] = $have + 1;
			$placed++;
		}
		return $placed;
	}

	/**
	 * @param list<array<string,mixed>> $parked
	 * @param list<array<string,mixed>> $placed
	 * @param array<string,mixed> $state
	 * @return array{id:int,from:string,entry:array<string,mixed>}|null
	 */
	private function fillOneMorningSlot(
		\CodeIgniter\Database\BaseConnection $db,
		int $day,
		array $slot,
		array $parked,
		array $placed,
		array &$state
	): ?array {
		$slotId = (int) ($slot['id'] ?? 0);
		$parkedOrder = $parked;
		usort($parkedOrder, function (array $a, array $b) use ($state, $day): int {
			$aNew = $this->dayHasCourse($state, $a, $day) ? 1 : 0;
			$bNew = $this->dayHasCourse($state, $b, $day) ? 1 : 0;
			if ($aNew !== $bNew) {
				return $aNew <=> $bNew;
			}
			return ((int) ($a['id'] ?? 0)) <=> ((int) ($b['id'] ?? 0));
		});
		foreach ($parkedOrder as $entry) {
			if (!$this->entryMayOccupySlot($entry, $day, $slot, $state)) {
				continue;
			}
			$db->table('timetable_entries')->where('id', (int) $entry['id'])->update([
				'day_of_week' => $day,
				'slot_id' => $slotId,
			]);
			$entry['day_of_week'] = $day;
			$entry['slot_id'] = $slotId;
			$entry['start_time'] = (string) ($slot['start_time'] ?? '');
			$entry['end_time'] = (string) ($slot['end_time'] ?? '');
			$this->addScheduledEntry($state, $entry);
			return ['id' => (int) $entry['id'], 'from' => 'parking', 'entry' => $entry];
		}

		$movers = $placed;
		usort($movers, function (array $a, array $b): int {
			$aPe = TimetableGeneratorService::isPhysicalEducationSportTitle((string) ($this->metaForEntry($a)['course_title'] ?? '')) ? 1 : 0;
			$bPe = TimetableGeneratorService::isPhysicalEducationSportTitle((string) ($this->metaForEntry($b)['course_title'] ?? '')) ? 1 : 0;
			if ($aPe !== $bPe) {
				return $aPe <=> $bPe;
			}
			return TimetableGeneratorService::clockMinutesFromString((string) ($b['start_time'] ?? '00:00'))
				<=> TimetableGeneratorService::clockMinutesFromString((string) ($a['start_time'] ?? '00:00'));
		});
		foreach ($movers as $entry) {
			if ($this->entryIsLocked($entry)) {
				continue;
			}
			$fromDay = (int) ($entry['day_of_week'] ?? -1);
			$fromSlot = (int) ($entry['slot_id'] ?? 0);
			if ($fromDay < 0 || $fromSlot <= 0) {
				continue;
			}
			if (TimetableGeneratorService::isMorningClock((string) ($entry['start_time'] ?? ''))) {
				continue;
			}
			$meta = $this->metaForEntry($entry);
			$lastHour = TimetableGeneratorService::isPhysicalEducationSportTitle((string) ($meta['course_title'] ?? ''))
				|| ($this->secondaryCriteria !== null && $this->secondaryCriteria->prefersLastHour($meta));
			$afterLessons = $this->secondaryCriteria !== null && $this->secondaryCriteria->requiresAfterLessons($meta);
			$homework = NurseryTimetableCriteria::isNurseryRow($meta)
				&& NurseryTimetableCriteria::isHomeworkCourse((string) ($meta['course_title'] ?? ''));
			if ($lastHour || $afterLessons || $homework) {
				continue;
			}
			$this->removeScheduledEntry($state, $entry);
			if (!$this->entryMayOccupySlot($entry, $day, $slot, $state)) {
				$this->addScheduledEntry($state, $entry);
				continue;
			}
			$db->table('timetable_entries')->where('id', (int) $entry['id'])->update([
				'day_of_week' => $day,
				'slot_id' => $slotId,
			]);
			$entry['day_of_week'] = $day;
			$entry['slot_id'] = $slotId;
			$entry['start_time'] = (string) ($slot['start_time'] ?? '');
			$entry['end_time'] = (string) ($slot['end_time'] ?? '');
			$this->addScheduledEntry($state, $entry);
			return ['id' => (int) $entry['id'], 'from' => 'afternoon', 'entry' => $entry];
		}

		return null;
	}

	/**
	 * @param array<string,mixed> $entry
	 * @param array<string,mixed> $slot
	 * @param array<string,mixed> $state
	 */
	private function entryMayOccupySlot(array $entry, int $day, array $slot, array $state): bool
	{
		$classId = (int) ($entry['class_id'] ?? 0);
		$staffId = (int) ($entry['staff_id'] ?? 0);
		$slotId = (int) ($slot['id'] ?? 0);
		$key = $day . ':' . $slotId;
		if ($classId > 0 && !empty($state['class_busy'][$classId . ':' . $key])) {
			return false;
		}
		if ($staffId > 0 && !empty($state['staff_busy'][$staffId . ':' . $key])) {
			return false;
		}
		$range = $this->slotTimeRange($slot);
		if ($staffId > 0 && $range !== null && $this->staffTimeConflictIds($state, $staffId, $day, $range['start'], $range['end']) !== []) {
			return false;
		}
		if ($day === 6 && $this->secondaryCriteria === null) {
			return false;
		}
		if ($this->secondaryCriteria !== null) {
			$meta = $this->metaForEntry($entry);
			if (!$this->secondaryCriteria->slotAllowed(
				$meta,
				$day,
				(string) ($slot['start_time'] ?? ''),
				(string) ($slot['end_time'] ?? '')
			)) {
				return false;
			}
		}
		$meta = $this->metaForEntry($entry);
		if (NurseryTimetableCriteria::isNurseryRow($meta)) {
			$title = (string) ($meta['course_title'] ?? '');
			$homework = NurseryTimetableCriteria::isHomeworkCourse($title);
			$start = (string) ($slot['start_time'] ?? '');
			if ($homework && TimetableGeneratorService::isMorningClock($start)) {
				return false;
			}
			if ($this->wouldExceedSubjectDayLimit($state, $entry, $day)) {
				return false;
			}
		}
		return true;
	}

	/** Park leftover colliding rows. Never write them back onto the grid. */
	public function parkAllConflicts(
		int $scheduleId,
		int $schoolId,
		int $filterClassId = 0,
		int $filterStaffId = 0
	): int {
		$ids = $this->collectConflictEntryIds(
			$this->scheduledEntries($scheduleId, $schoolId, $filterClassId, $filterStaffId)
		);
		$ids = array_values(array_filter($ids));
		if ($ids === []) {
			return 0;
		}
		$db = \Config\Database::connect();
		$upd = $db->table('timetable_entries')->whereIn('id', $ids);
		if ($db->fieldExists('is_locked', 'timetable_entries')) {
			$upd->groupStart()->where('is_locked', 0)->orWhere('is_locked IS NULL', null, false)->groupEnd();
		}
		$upd->update([
			'day_of_week' => -1,
			'slot_id' => 0,
		]);
		return count($ids);
	}

	/** @return array<string,array<string,mixed>> */
	private function loadAssignmentMeta(int $scheduleId, int $schoolId): array
	{
		$db = \Config\Database::connect();
		$schedule = $db->table('timetable_schedules')->where('id', $scheduleId)->get(1)->getRowArray();
		$year = (int) ($schedule['academic_year'] ?? 0);
		$term = (int) ($schedule['term'] ?? 0);
		if ($year <= 0 || $term <= 0) {
			return [];
		}

		$rows = $db->table('course_records cr')
			->select('cr.id AS course_record_id, cr.class AS class_id, cr.course AS course_id, cr.lecturer, c.credit, c.title AS course_title,
				l.title AS level_title, l.title AS level_name, l.faculty_id AS level_faculty_id,
				f.title AS faculty_title, f.abbrev AS faculty_abbrev, f.type AS faculty_type,
				d.faculty_id AS dept_faculty_id, d.code AS dept_code, d.title AS dept_title,
				cl.title AS class_title,
				CONCAT(s.fname, " ", s.lname) AS teacher_name')
			->join('classes cl', 'cl.id = cr.class')
			->join('levels l', 'l.id = cl.level', 'left')
			->join('departments d', 'd.id = cl.department', 'left')
			->join('faculty f', 'f.id = d.faculty_id', 'left')
			->join('courses c', 'c.id = cr.course')
			->join('staffs s', 's.id = cr.lecturer', 'left')
			->where('cl.school_id', $schoolId)
			->where('cr.year', $year)
			->where("find_in_set($term, cr.term) >", 0, false)
			->get()->getResultArray();

		$out = [];
		foreach ($rows as $row) {
			$row['track_key'] = \App\Libraries\TimetableTrack::resolveFromRow($row);
			$out[$this->assignmentKey(
				(int) ($row['course_record_id'] ?? 0),
				(int) ($row['class_id'] ?? 0),
				(int) ($row['course_id'] ?? 0),
				(int) ($row['lecturer'] ?? 0)
			)] = $row;
		}

		return $out;
	}

	/**
	 * @param list<array<string,mixed>> $scheduled
	 * @return array<string,mixed>
	 */
	private function buildScheduleState(array $scheduled): array
	{
		$state = [
			'by_id' => [],
			'class_busy' => [],
			'staff_busy' => [],
			'staff_time' => [],
			'subject_day_count' => [],
			'class_day_usage' => [],
			'class_day_courses' => [],
		];
		foreach ($scheduled as $entry) {
			$this->addScheduledEntry($state, $entry);
		}
		return $state;
	}

	/** @param array<string,mixed> $state */
	private function addScheduledEntry(array &$state, array $entry): void
	{
		$entryId = (int) ($entry['id'] ?? 0);
		$day = (int) ($entry['day_of_week'] ?? -1);
		$slotId = (int) ($entry['slot_id'] ?? 0);
		if ($entryId <= 0 || $day < 0 || $slotId <= 0) {
			return;
		}
		$classId = (int) ($entry['class_id'] ?? 0);
		$staffId = (int) ($entry['staff_id'] ?? 0);
		$key = $day . ':' . $slotId;
		$state['by_id'][$entryId] = $entry;
		$state['class_busy'][$classId . ':' . $key] = $entryId;
		if ($staffId > 0) {
			$state['staff_busy'][$staffId . ':' . $key] = $entryId;
			$range = $this->entryTimeRange($entry);
			if ($range !== null) {
				$state['staff_time'][$staffId][$day][] = [
					'id' => $entryId,
					'start' => $range['start'],
					'end' => $range['end'],
				];
			}
		}
		$subjectKey = $classId . ':' . (int) ($entry['course_id'] ?? 0) . ':' . $day;
		$state['subject_day_count'][$subjectKey] = (int) ($state['subject_day_count'][$subjectKey] ?? 0) + 1;
		$state['class_day_usage'][$classId . ':' . $day] = (int) ($state['class_day_usage'][$classId . ':' . $day] ?? 0) + 1;
		$courseId = (int) ($entry['course_id'] ?? 0);
		if ($classId > 0 && $courseId > 0) {
			$state['class_day_courses'][$classId . ':' . $day][$courseId] = true;
		}
	}

	/** @param array<string,mixed> $state */
	private function removeScheduledEntry(array &$state, array $entry): void
	{
		$entryId = (int) ($entry['id'] ?? 0);
		$day = (int) ($entry['day_of_week'] ?? -1);
		$slotId = (int) ($entry['slot_id'] ?? 0);
		if ($entryId <= 0 || $day < 0 || $slotId <= 0) {
			return;
		}
		$classId = (int) ($entry['class_id'] ?? 0);
		$staffId = (int) ($entry['staff_id'] ?? 0);
		$key = $day . ':' . $slotId;
		unset($state['by_id'][$entryId], $state['class_busy'][$classId . ':' . $key]);
		if ($staffId > 0) {
			unset($state['staff_busy'][$staffId . ':' . $key]);
			if (!empty($state['staff_time'][$staffId][$day])) {
				$state['staff_time'][$staffId][$day] = array_values(array_filter(
					$state['staff_time'][$staffId][$day],
					static fn (array $row): bool => (int) ($row['id'] ?? 0) !== $entryId
				));
			}
		}
		$subjectKey = $classId . ':' . (int) ($entry['course_id'] ?? 0) . ':' . $day;
		$state['subject_day_count'][$subjectKey] = max(0, (int) ($state['subject_day_count'][$subjectKey] ?? 0) - 1);
		$state['class_day_usage'][$classId . ':' . $day] = max(0, (int) ($state['class_day_usage'][$classId . ':' . $day] ?? 0) - 1);
		$courseId = (int) ($entry['course_id'] ?? 0);
		if ($classId > 0 && $courseId > 0) {
			unset($state['class_day_courses'][$classId . ':' . $day][$courseId]);
			if (($state['subject_day_count'][$subjectKey] ?? 0) > 0) {
				$state['class_day_courses'][$classId . ':' . $day][$courseId] = true;
			}
		}
	}

	/** @param array<string,mixed> $state */
	private function countDirectCandidates(array $entry, array $days, \App\Models\TimetableSchemaModel $schema, int $schoolId, array $state): int
	{
		$count = 0;
		foreach ($this->candidateSlots($entry, $days, $schema, $schoolId, $state, false) as $_candidate) {
			$count++;
		}
		return $count;
	}

	/**
	 * @param array<string,mixed> $state
	 * @return array{day:int,slot_id:int}|null
	 */
	private function findBestDirectPlacement(
		array $entry,
		array $days,
		\App\Models\TimetableSchemaModel $schema,
		int $schoolId,
		array $state,
		bool $ignoreDayLimit = false
	): ?array {
		$candidates = $this->candidateSlots($entry, $days, $schema, $schoolId, $state, false, $ignoreDayLimit);
		return $candidates[0] ?? null;
	}

	/**
	 * @param array<string,mixed> $state
	 * @return array{day:int,slot_id:int}|null
	 */
	private function placeByRelocatingOneBlocker(
		\CodeIgniter\Database\BaseConnection $db,
		array $entry,
		array $days,
		\App\Models\TimetableSchemaModel $schema,
		int $schoolId,
		array &$state
	): ?array {
		$candidates = $this->candidateSlots($entry, $days, $schema, $schoolId, $state, true);
		foreach ($candidates as $candidate) {
			$blockers = $candidate['blockers'] ?? [];
			if (count($blockers) !== 1) {
				continue;
			}
			$blockerId = (int) $blockers[0];
			$blocker = $state['by_id'][$blockerId] ?? null;
			if (!is_array($blocker) || $this->entryIsLocked($blocker)) {
				continue;
			}
			$this->removeScheduledEntry($state, $blocker);
			$relocation = $this->findBestDirectPlacement($blocker, $days, $schema, $schoolId, $state);
			if ($relocation === null) {
				$this->addScheduledEntry($state, $blocker);
				continue;
			}
			$db->table('timetable_entries')->where('id', $blockerId)->update([
				'day_of_week' => $relocation['day'],
				'slot_id' => $relocation['slot_id'],
			]);
			$blocker['day_of_week'] = $relocation['day'];
			$blocker['slot_id'] = $relocation['slot_id'];
			$this->addScheduledEntry($state, $blocker);
			return ['day' => (int) $candidate['day'], 'slot_id' => (int) $candidate['slot_id']];
		}
		return null;
	}

	/**
	 * @param array<string,mixed> $state
	 * @return list<array{day:int,slot_id:int,score:int,blockers?:list<int>}>
	 */
	private function candidateSlots(
		array $entry,
		array $days,
		\App\Models\TimetableSchemaModel $schema,
		int $schoolId,
		array $state,
		bool $allowSingleBlocker,
		bool $ignoreDayLimit = false
	): array {
		$classId = (int) ($entry['class_id'] ?? 0);
		$staffId = (int) ($entry['staff_id'] ?? 0);
		$trackKey = $schema->trackForClass($schoolId, $classId);
		$days = \App\Models\TimetableSchemaModel::weekDaysForTrack($this->timetableSettings, $trackKey);
		$slots = array_values(array_filter(
			$schema->generationSlots($schoolId, $trackKey),
			static fn ($s) => empty($s['is_break'])
		));
		$blocked = $schema->specialTimesMap($schoolId, $trackKey);
		$candidates = [];

		usort($days, function ($a, $b) use ($state, $classId, $entry): int {
			$subA = $this->subjectDayCountForState($state, $entry, (int) $a);
			$subB = $this->subjectDayCountForState($state, $entry, (int) $b);
			if ($subA !== $subB) {
				return $subA <=> $subB;
			}
			return (int) ($state['class_day_usage'][$classId . ':' . $a] ?? 0)
				<=> (int) ($state['class_day_usage'][$classId . ':' . $b] ?? 0);
		});

		foreach ($days as $day) {
			if (!$ignoreDayLimit && $this->wouldExceedSubjectDayLimit($state, $entry, (int) $day)) {
				continue;
			}
			foreach ($slots as $slotIndex => $slot) {
				$slotId = (int) ($slot['id'] ?? 0);
				if ($slotId <= 0) {
					continue;
				}
				$range = $this->slotTimeRange($slot);
				if ($range === null) {
					continue;
				}
				$key = $day . ':' . $slotId;
				if (!empty($blocked[$key])) {
					continue;
				}
				$meta = $this->metaForEntry($entry);
				$meta['_track_key'] = $trackKey;
				if ($this->secondaryCriteria !== null) {
					$start = (string) ($slot['start_time'] ?? '');
					$end = (string) ($slot['end_time'] ?? '');
					if (!$this->secondaryCriteria->slotAllowed($meta, (int) $day, $start, $end)) {
						continue;
					}
				}
				if (NurseryTimetableCriteria::isNurseryRow($meta)
					&& NurseryTimetableCriteria::isHomeworkCourse((string) ($meta['course_title'] ?? ''))
					&& TimetableGeneratorService::isMorningClock((string) ($slot['start_time'] ?? ''))) {
					continue;
				}
				$classBlocker = (int) ($state['class_busy'][$classId . ':' . $key] ?? 0);
				$blockers = array_values(array_unique(array_filter([$classBlocker])));
				if ($staffId > 0) {
					$slotStaffBlocker = (int) ($state['staff_busy'][$staffId . ':' . $key] ?? 0);
					if ($slotStaffBlocker > 0) {
						$blockers[] = $slotStaffBlocker;
					}
					foreach ($this->staffTimeConflictIds($state, $staffId, (int) $day, $range['start'], $range['end']) as $staffBlockerId) {
						$blockers[] = $staffBlockerId;
					}
				}
				$blockers = array_values(array_unique(array_filter($blockers)));
				if ($blockers !== [] && (!$allowSingleBlocker || count($blockers) > 1)) {
					continue;
				}
				$candidates[] = [
					'day' => (int) $day,
					'slot_id' => $slotId,
					'score' => $this->scoreCandidate(
						$state,
						$entry,
						(int) $day,
						$slotId,
						count($blockers),
						$range,
						(int) $slotIndex,
						count($slots)
					),
					'blockers' => $blockers,
				];
			}
		}

		usort($candidates, static function (array $a, array $b): int {
			return $a['score'] <=> $b['score'];
		});
		return $candidates;
	}

	/** @param array<string,mixed> $state */
	private function scoreCandidate(
		array $state,
		array $entry,
		int $day,
		int $slotId,
		int $blockerCount,
		?array $candidateRange = null,
		int $slotIndex = 0,
		int $slotCount = 0
	): int {
		$classId = (int) ($entry['class_id'] ?? 0);
		$courseId = (int) ($entry['course_id'] ?? 0);
		$meta = $this->metaForEntry($entry);
		$hours = TimetableGeneratorService::weeklyHoursFromCourse($meta);
		$track = strtolower(trim((string) ($meta['track_key'] ?? '')));
		$useDoubles = $hours >= 3 && !NurseryTimetableCriteria::isNurseryRow($meta);
		$peSport = TimetableGeneratorService::isPhysicalEducationSportTitle((string) ($meta['course_title'] ?? ''));
		$lastHour = $peSport || ($this->secondaryCriteria !== null && $this->secondaryCriteria->prefersLastHour($meta));
		$afterLessons = $this->secondaryCriteria !== null && $this->secondaryCriteria->requiresAfterLessons($meta);

		$score = $blockerCount * 1000;
		$sameDay = $this->subjectDayCountForState($state, $entry, $day);

		if ($afterLessons) {
			$start = $candidateRange !== null
				? sprintf('%02d:%02d:00', intdiv((int) $candidateRange['start'], 60), ((int) $candidateRange['start']) % 60)
				: null;
			$end = $candidateRange !== null
				? sprintf('%02d:%02d:00', intdiv((int) $candidateRange['end'], 60), ((int) $candidateRange['end']) % 60)
				: null;
			$score += $this->secondaryCriteria->afterLessonScoreDelta($meta, $start, $end);
		} elseif ($lastHour && $slotCount > 0) {
			// Strongly prefer last teaching periods of the day.
			$score += ($slotCount - 1 - $slotIndex) * 800;
			$lateStart = max(0, $slotCount - 3);
			if ($slotIndex < $lateStart) {
				$score += 5000;
			}
		} elseif ($candidateRange !== null && TimetableGeneratorService::isMorningClock(
			sprintf('%02d:%02d:00', intdiv((int) $candidateRange['start'], 60), ((int) $candidateRange['start']) % 60)
		)) {
			$score -= 2500;
		} elseif ($slotCount > 0 && $slotIndex >= max(0, $slotCount - 3)) {
			// Leave end-of-day freer for PE when staging non-PE subjects.
			$score += 900;
		} else {
			$score += 4000;
		}

		if ($useDoubles) {
			// Complete a double when this subject already has one period today.
			if ($sameDay === 1) {
				$score -= 900;
				if ($candidateRange !== null && $this->rangeTouchesExistingSubjectPeriod($state, $entry, $day, $candidateRange)) {
					$score -= 700;
				}
			} else {
				$score += $sameDay * 300;
			}

			$occupied = $this->occupiedSubjectDays($state, $classId, $courseId);
			if ($sameDay === 0) {
				if ($occupied === []) {
					$score += in_array($day, [0, 2, 4], true) ? -50 : 40;
				}
				foreach ($occupied as $od) {
					$dist = abs($day - (int) $od);
					if ($dist === 1) {
						$score += 2500;
					} else {
						$score -= min(40, $dist * 12);
					}
				}
			}
		} else {
			$score += $sameDay * 300;
		}

		$score += (int) ($state['class_day_usage'][$classId . ':' . $day] ?? 0) * 80;
		$score += $peSport ? 0 : $slotId;
		if ($this->secondaryCriteria !== null && $candidateRange !== null) {
			$startH = intdiv((int) $candidateRange['start'], 60);
			$startM = ((int) $candidateRange['start']) % 60;
			$endH = intdiv((int) $candidateRange['end'], 60);
			$endM = ((int) $candidateRange['end']) % 60;
			$start = sprintf('%02d:%02d:00', $startH, $startM);
			$end = sprintf('%02d:%02d:00', $endH, $endM);
			$meta['_track_key'] = $track;
			$score += $this->secondaryCriteria->morningScoreDelta($meta, $start, $end);
		}
		if (NurseryTimetableCriteria::isNurseryRow($meta) && $candidateRange !== null) {
			$startH = intdiv((int) $candidateRange['start'], 60);
			$startM = ((int) $candidateRange['start']) % 60;
			$endH = intdiv((int) $candidateRange['end'], 60);
			$endM = ((int) $candidateRange['end']) % 60;
			$start = sprintf('%02d:%02d:00', $startH, $startM);
			$end = sprintf('%02d:%02d:00', $endH, $endM);
			$score += NurseryTimetableCriteria::varietyScoreDelta(
				$this->uniqueCoursesOnDay($state, $classId, $day),
				$this->dayHasCourse($state, $entry, $day)
			);
			$score += NurseryTimetableCriteria::homeworkScoreDelta($meta, $start, $end);
		}
		return $score;
	}

	/**
	 * @param array<string,mixed> $state
	 * @return list<int>
	 */
	private function occupiedSubjectDays(array $state, int $classId, int $courseId): array
	{
		$out = [];
		foreach ($state['subject_day_count'] ?? [] as $key => $count) {
			if ((int) $count <= 0) {
				continue;
			}
			$parts = explode(':', (string) $key);
			if (count($parts) !== 3) {
				continue;
			}
			if ((int) $parts[0] === $classId && (int) $parts[1] === $courseId) {
				$out[] = (int) $parts[2];
			}
		}
		return $out;
	}

	/**
	 * @param array<string,mixed> $state
	 * @param array{start:int,end:int} $range
	 */
	private function rangeTouchesExistingSubjectPeriod(array $state, array $entry, int $day, array $range): bool
	{
		$classId = (int) ($entry['class_id'] ?? 0);
		$courseId = (int) ($entry['course_id'] ?? 0);
		foreach ($state['by_id'] ?? [] as $row) {
			if ((int) ($row['class_id'] ?? 0) !== $classId || (int) ($row['course_id'] ?? 0) !== $courseId) {
				continue;
			}
			if ((int) ($row['day_of_week'] ?? -1) !== $day) {
				continue;
			}
			$start = (string) ($row['start_time'] ?? '');
			$end = (string) ($row['end_time'] ?? '');
			if ($start === '' || $end === '') {
				continue;
			}
			$existing = [
				'start' => $this->timeToMinutes($start),
				'end' => $this->timeToMinutes($end),
			];
			$gap = min(
				abs($range['end'] - $existing['start']),
				abs($existing['end'] - $range['start'])
			);
			if ($gap <= 25) {
				return true;
			}
		}
		return false;
	}

	/** @param array<string,mixed> $state */
	private function subjectDayCountForState(array $state, array $entry, int $day): int
	{
		$classId = (int) ($entry['class_id'] ?? 0);
		$courseId = (int) ($entry['course_id'] ?? 0);
		return (int) ($state['subject_day_count'][$classId . ':' . $courseId . ':' . $day] ?? 0);
	}

	/** @param array<string,mixed> $state */
	private function uniqueCoursesOnDay(array $state, int $classId, int $day): int
	{
		return count($state['class_day_courses'][$classId . ':' . $day] ?? []);
	}

	/** @param array<string,mixed> $state */
	private function dayHasCourse(array $state, array $entry, int $day): bool
	{
		$classId = (int) ($entry['class_id'] ?? 0);
		$courseId = (int) ($entry['course_id'] ?? 0);
		return $classId > 0 && $courseId > 0 && !empty($state['class_day_courses'][$classId . ':' . $day][$courseId]);
	}

	/** @param array<string,mixed> $state */
	private function wouldExceedSubjectDayLimit(array $state, array $entry, int $day): bool
	{
		$meta = $this->metaForEntry($entry);
		$hours = TimetableGeneratorService::weeklyHoursFromCourse($meta);
		$maxPerDay = $this->maxPerDayForEntry($meta, $hours, $state, $entry, $day);
		return $this->subjectDayCountForState($state, $entry, $day) + 1 > $maxPerDay;
	}

	/** @return array<string,mixed> */
	private function metaForEntry(array $entry): array
	{
		$key = $this->keyFromEntry($entry);
		return $this->assignmentMeta[$key] ?? [
			'course_title' => '',
			'credit' => 0,
			'track_key' => '',
		];
	}

	private function maxPerDayForEntry(array $meta, int $hours, array $state = [], array $entry = [], int $day = -1): int
	{
		if (NurseryTimetableCriteria::isNurseryRow($meta)) {
			if ($state !== [] && $entry !== [] && $day >= 0) {
				return NurseryTimetableCriteria::maxPerDay(
					$this->uniqueCoursesOnDay($state, (int) ($entry['class_id'] ?? 0), $day),
					$this->dayHasCourse($state, $entry, $day)
				);
			}
			return 1;
		}
		if ($this->secondaryCriteria !== null) {
			$peMax = $this->secondaryCriteria->peMaxPerDay($meta, $hours);
			if ($peMax !== null) {
				return $peMax;
			}
		}
		if ($this->requiresSpreadAcrossDays($meta)) {
			return 1;
		}
		$fallback = ($hours > 0 && $hours <= 2) ? 1 : 2;
		if ($this->secondaryCriteria !== null) {
			return $this->secondaryCriteria->packedDailyCap($meta, $hours, $fallback);
		}
		return $fallback;
	}

	private function requiresSpreadAcrossDays(array $meta): bool
	{
		$track = strtolower(trim((string) ($meta['track_key'] ?? '')));
		if (!in_array($track, ['primary', 'nursery'], true)) {
			return false;
		}
		$title = strtolower(trim(preg_replace('/\s+/', ' ', (string) ($meta['course_title'] ?? ''))));
		return strpos($title, 'mathematics') === false && preg_match('/\bmath\b/', $title) !== 1;
	}

	/**
	 * @return list<array<string,mixed>>
	 */
	private function scheduledEntries(int $scheduleId, int $schoolId, int $filterClassId = 0, int $filterStaffId = 0): array
	{
		$builder = \Config\Database::connect()->table('timetable_entries')
			->select('timetable_entries.*, ts.start_time, ts.end_time')
			->join('timetable_slots ts', 'ts.id = timetable_entries.slot_id', 'left')
			->where('timetable_entries.schedule_id', $scheduleId)
			->where('timetable_entries.school_id', $schoolId)
			->where('timetable_entries.entry_type', 'lesson')
			->where('timetable_entries.day_of_week >=', 0)
			->where('timetable_entries.slot_id >', 0);
		if ($filterClassId > 0) {
			$builder->where('timetable_entries.class_id', $filterClassId);
		}
		if ($filterStaffId > 0) {
			$builder->where('timetable_entries.staff_id', $filterStaffId);
		}
		return $builder->orderBy('timetable_entries.id', 'ASC')->get()->getResultArray();
	}

	/**
	 * @param list<array<string,mixed>> $scheduled
	 * @return list<int>
	 */
	private function collectConflictEntryIds(array $scheduled): array
	{
		$byClassSlot = [];
		$teacherDayRows = [];
		foreach ($scheduled as $entry) {
			$entryId = (int) ($entry['id'] ?? 0);
			$classId = (int) ($entry['class_id'] ?? 0);
			$staffId = (int) ($entry['staff_id'] ?? 0);
			$day = (int) ($entry['day_of_week'] ?? -1);
			$slotId = (int) ($entry['slot_id'] ?? 0);
			if ($entryId <= 0 || $classId <= 0 || $day < 0 || $slotId <= 0) {
				continue;
			}
			$byClassSlot[$classId . ':' . $day . ':' . $slotId][] = $entry;
			if ($staffId > 0) {
				$teacherDayRows[$staffId . ':' . $day][] = $entry;
			}
		}

		$ids = [];
		foreach ($byClassSlot as $group) {
			if (count($group) <= 1) {
				continue;
			}
			usort($group, static function (array $a, array $b): int {
				$la = (int) ($a['is_locked'] ?? 0);
				$lb = (int) ($b['is_locked'] ?? 0);
				if ($la !== $lb) {
					return $lb <=> $la;
				}
				return ((int) ($a['id'] ?? 0)) <=> ((int) ($b['id'] ?? 0));
			});
			$drop = array_slice($group, 1);
			foreach ($drop as $entry) {
				if ((int) ($entry['is_locked'] ?? 0) === 1) {
					continue;
				}
				$ids[(int) $entry['id']] = (int) $entry['id'];
			}
		}
		foreach ($teacherDayRows as $group) {
			if (count($group) <= 1) {
				continue;
			}
			usort($group, static function (array $a, array $b): int {
				$la = (int) ($a['is_locked'] ?? 0);
				$lb = (int) ($b['is_locked'] ?? 0);
				if ($la !== $lb) {
					return $lb <=> $la;
				}
				return ((int) ($a['id'] ?? 0)) <=> ((int) ($b['id'] ?? 0));
			});
			$kept = [];
			foreach ($group as $entry) {
				$entryId = (int) ($entry['id'] ?? 0);
				$slotId = (int) ($entry['slot_id'] ?? 0);
				$start = $this->timeToMinutes((string) ($entry['start_time'] ?? ''));
				$end = $this->timeToMinutes((string) ($entry['end_time'] ?? ''));
				$hasTime = $end > $start;
				$collides = false;
				foreach ($kept as $other) {
					$sameSlot = (int) ($other['slot_id'] ?? 0) === $slotId;
					$otherHasTime = (int) ($other['end'] ?? 0) > (int) ($other['start'] ?? 0);
					$timeClash = $hasTime && $otherHasTime
						&& $start < (int) $other['end'] && (int) $other['start'] < $end;
					if ($sameSlot || $timeClash) {
						$collides = true;
						break;
					}
				}
				if ($collides) {
					if ((int) ($entry['is_locked'] ?? 0) !== 1) {
						$ids[$entryId] = $entryId;
					}
					continue;
				}
				$kept[] = [
					'id' => $entryId,
					'slot_id' => $slotId,
					'start' => $start,
					'end' => $end,
				];
			}
		}

		return array_values($ids);
	}

	/** @return array{start:int,end:int}|null */
	private function entryTimeRange(array $entry): ?array
	{
		$start = trim((string) ($entry['start_time'] ?? ''));
		$end = trim((string) ($entry['end_time'] ?? ''));
		if ($start === '' || $end === '') {
			return null;
		}
		return [
			'start' => $this->timeToMinutes($start),
			'end' => $this->timeToMinutes($end),
		];
	}

	/** @param array<string,mixed> $slot @return array{start:int,end:int}|null */
	private function slotTimeRange(array $slot): ?array
	{
		$start = trim((string) ($slot['start_time'] ?? ''));
		$end = trim((string) ($slot['end_time'] ?? ''));
		if ($start === '' || $end === '') {
			return null;
		}
		return [
			'start' => $this->timeToMinutes($start),
			'end' => $this->timeToMinutes($end),
		];
	}

	/** @param array<string,mixed> $state @return list<int> */
	private function staffTimeConflictIds(array $state, int $staffId, int $day, int $start, int $end): array
	{
		$ids = [];
		foreach ($state['staff_time'][$staffId][$day] ?? [] as $row) {
			$otherStart = (int) ($row['start'] ?? 0);
			$otherEnd = (int) ($row['end'] ?? 0);
			if ($start < $otherEnd && $otherStart < $end) {
				$ids[] = (int) ($row['id'] ?? 0);
			}
		}
		return array_values(array_unique(array_filter($ids)));
	}

	private function timeToMinutes(string $time): int
	{
		$parts = explode(':', substr($time, 0, 8));
		return ((int) ($parts[0] ?? 0)) * 60 + (int) ($parts[1] ?? 0);
	}
}
