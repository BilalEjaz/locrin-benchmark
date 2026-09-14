<?php

namespace App\Services\Timetable;

use App\Libraries\TimetableClassLabel;

/**
 * Constraint-based timetable generator (aSc-style weekly grid).
 *
 * Primary/Nursery: mostly one period per day (math may cluster).
 * Secondary (O/A Level, RTB, Special): applies SecondaryTimetableCriteria —
 * doubles for 3+ hours, non-adjacent days, PE end-of-day, Math/Physics/ANP
 * morning bias, teacher windows, clinical mornings, combined classes.
 */
class TimetableGeneratorService
{
	/** @var list<int> Mon=0 .. Fri=4, Sun=6 */
	private $days = [0, 1, 2, 3, 4];

	/** @var list<array<string,mixed>> */
	private $teachingSlots = [];

	/** @var array<int,array{start:string,end:string}> */
	private $slotTimes = [];

	/** @var array<string,bool> */
	private $classBusy = [];

	/** @var array<string,bool> */
	private $staffBusy = [];

	/** @var array<int,array<int,list<array{start:int,end:int}>>> */
	private $staffTimeBookings = [];

	/** @var array<string,int> */
	private $subjectDayCount = [];

	/** @var array<string,int> */
	private $classDayUsage = [];

	/** @var array<int,int> */
	private $globalDayUsage = [];

	/** @var array<string,bool> */
	private $blocked = [];

	/** @var list<string> */
	private $warnings = [];

	/** @var SecondaryTimetableCriteria|null */
	private $secondaryCriteria = null;

	/** @var list<array<string,mixed>> */
	private $customRules = [];

	/** @var array<int,array<string,mixed>> */
	private $assignmentByClassCourse = [];

	/** @var array<int,string> class_id => track_key */
	private $classTracks = [];

	/** @var array<string,array<string,int>> track => "start|end" => slot_id */
	private $trackClockSlots = [];

	/** @var callable|null */
	private $progressHandler = null;

	/** @var callable|null */
	private $abortHandler = null;

	/** @param list<array<string,mixed>> $rules */
	public function setCustomRules(array $rules): void
	{
		$this->customRules = $rules;
	}

	/**
	 * Map combined-class copies onto the partner class's own track bells.
	 *
	 * @param array<int,string> $classTracks
	 * @param array<string,array<string,int>> $trackClockSlots
	 */
	public function setCombineSlotMaps(array $classTracks, array $trackClockSlots): void
	{
		$this->classTracks = $classTracks;
		$this->trackClockSlots = $trackClockSlots;
	}

	public function setProgressHandler(?callable $handler): void
	{
		$this->progressHandler = $handler;
	}

	public function setAbortHandler(?callable $handler): void
	{
		$this->abortHandler = $handler;
	}

	private function generationWasDiscarded(): bool
	{
		return $this->abortHandler !== null && (bool) ($this->abortHandler)();
	}

	public static function distributeWeeklyHours(int $hours): array
	{
		$hours = max(0, min(20, $hours));
		if ($hours === 0) {
			return [];
		}
		if ($hours === 1) {
			return [1];
		}
		// Never put both periods of a 2h/week course on the same day.
		if ($hours === 2) {
			return [1, 1];
		}
		// 3+ hours: prefer adjacent doubles (2+1, 2+2, 2+2+1, …).
		$blocks = [];
		$remaining = $hours;
		while ($remaining >= 2) {
			$blocks[] = 2;
			$remaining -= 2;
		}
		if ($remaining === 1) {
			$blocks[] = 1;
		}

		return $blocks;
	}

	public static function weeklyHoursFromCourse(array $course): int
	{
		$explicit = (int) ($course['weekly_hours'] ?? 0);
		if ($explicit > 0 && $explicit <= 20) {
			return $explicit;
		}

		// Credit = weekly periods on the timetable (e.g. credit 3 → 3 lessons per week).
		$credit = (float) ($course['credit'] ?? 0);
		if ($credit >= 1 && $credit <= 20) {
			return (int) round($credit);
		}

		return self::defaultWeeklyHoursByTitle((string) ($course['course_title'] ?? ''));
	}

	public static function defaultWeeklyHoursByTitle(string $title): int
	{
		$t = strtolower(trim(preg_replace('/\s+/', ' ', $title)));
		if ($t === '') {
			return 3;
		}

		$rules = [
			'english' => 5,
			'mathematics' => 5,
			'math' => 5,
			'science' => 4,
			'set' => 4,
			'kinyarwanda' => 4,
			'social' => 3,
			'religious' => 3,
			'french' => 3,
			'physical education' => 2,
			'physical' => 2,
			'art' => 2,
			'craft' => 2,
			'behaviour' => 1,
			'behavior' => 1,
			'library' => 2,
			'pastoral' => 2,
			'life skills' => 2,
			'co-curricular' => 2,
		];

		foreach ($rules as $needle => $hours) {
			if (strpos($t, $needle) !== false) {
				return $hours;
			}
		}

		return 3;
	}

	/**
	 * @param list<array<string,mixed>> $assignments
	 * @param list<array<string,mixed>> $teachingSlots
	 * @param list<int> $days
	 * @param array<string,bool> $blocked
	 * @param list<array<string,mixed>> $contextAssignments All phase assignments so ANP/Stream combines can see each other.
	 * @return array{entries:list<array<string,mixed>>,warnings:list<string>}
	 */
	public function generate(array $assignments, array $teachingSlots, array $days = [0, 1, 2, 3, 4], array $blocked = [], bool $resetState = true, array $contextAssignments = []): array
	{
		if ($resetState) {
			$this->classBusy = [];
			$this->staffBusy = [];
			$this->staffTimeBookings = [];
			$this->subjectDayCount = [];
			$this->classDayUsage = [];
			$this->globalDayUsage = [];
			$this->warnings = [];
			// Keep slotTimes so partner classes on another track can share the same clock.
		}

		$this->secondaryCriteria = new SecondaryTimetableCriteria();
		$hydrate = $contextAssignments !== [] ? $contextAssignments : $assignments;
		$this->secondaryCriteria->hydrateFromAssignments($hydrate);
		$this->secondaryCriteria->hydrateCustomRules($this->customRules);
		$this->assignmentByClassCourse = [];
		foreach ($assignments as $row) {
			$classId = (int) ($row['class_id'] ?? 0);
			$courseId = (int) ($row['course_id'] ?? 0);
			if ($classId > 0 && $courseId > 0) {
				$this->assignmentByClassCourse[$classId . ':' . $courseId] = $row;
			}
		}

		$this->teachingSlots = $teachingSlots;
		$this->days = $days;
		$this->blocked = $blocked;
		$this->mergeSlotTimes($teachingSlots);
		foreach ($this->secondaryCriteria->relaxOverloadedRestrictions($hydrate, $teachingSlots, $days) as $warning) {
			$this->warnings[] = $warning;
		}

		$entries = [];
		$lessonNeeds = [];
		/** @var array<string,int> */
		$placedByAssignment = [];

		// Combined subjects first so paired classes claim the same slots together.
		usort($assignments, function (array $a, array $b): int {
			$pa = $this->secondaryCriteria && $this->secondaryCriteria->combinePartner($a) ? 0 : 1;
			$pb = $this->secondaryCriteria && $this->secondaryCriteria->combinePartner($b) ? 0 : 1;
			if ($pa !== $pb) {
				return $pa <=> $pb;
			}
			return 0;
		});

		$batchClassIds = [];
		foreach ($assignments as $row) {
			$cid = (int) ($row['class_id'] ?? 0);
			if ($cid > 0) {
				$batchClassIds[$cid] = true;
			}
		}

		foreach ($assignments as $row) {
			if ($this->isCombineFollowerInBatch($row, $batchClassIds)) {
				continue;
			}
			$hours = self::weeklyHoursFromCourse($row);
			$blocks = $this->lessonBlocksForCourse($row, $hours);
			foreach ($blocks as $blockSize) {
				$lessonNeeds[] = [
					'assignment' => $row,
					'block_size' => (int) $blockSize,
					'hours' => $hours,
				];
			}
		}

		$totalNeeds = count($lessonNeeds);
		$processed = 0;
		$guard = 0;
		$maxGuard = max($totalNeeds * 4, 80);
		if ($totalNeeds <= 80) {
			$this->sortLessonNeeds($lessonNeeds);
		} else {
			$this->sortLessonNeedsLight($lessonNeeds);
		}
		if ($this->progressHandler !== null) {
			($this->progressHandler)(0, max($totalNeeds, 1), $totalNeeds);
		}

		while ($lessonNeeds !== []) {
			if ($this->generationWasDiscarded()) {
				throw new TimetableJobCancelledException('Generation discarded');
			}
			if (++$guard > $maxGuard) {
				foreach ($lessonNeeds as $stuck) {
					$assignment = $stuck['assignment'];
					$classLabel = TimetableClassLabel::fromRow($assignment);
					$teacher = trim((string) ($assignment['teacher_name'] ?? ''));
					$this->warnings[] = 'Could not place ' . ($assignment['course_title'] ?? 'course')
						. ' in ' . ($classLabel !== '' ? $classLabel : 'class')
						. ($teacher !== '' ? ' (' . $teacher . ')' : '')
						. ' — ' . (int) $stuck['block_size'] . ' period(s)';
				}
				break;
			}

			$need = array_shift($lessonNeeds);
			$assignKey = $this->assignmentQuotaKey($need['assignment']);
			$quota = max(0, (int) $need['hours']);
			$already = (int) ($placedByAssignment[$assignKey] ?? 0);
			$remaining = $quota - $already;
			if ($remaining <= 0) {
				continue;
			}

			// Cap block size so we never place more periods than credit/weekly_hours.
			$blockSize = min((int) $need['block_size'], $remaining);
			$placed = $this->placeLesson($need['assignment'], $blockSize, (int) $need['hours']);
			if ($placed) {
				foreach ($placed as $entry) {
					$entries[] = $entry;
				}
				$placedByAssignment[$assignKey] = $already + count($placed);
				$partnerExtra = $this->placeCombinePartnerCopies($need['assignment'], $placed, $placedByAssignment);
				foreach ($partnerExtra as $entry) {
					$entries[] = $entry;
				}
			} elseif ($blockSize === 2 && $remaining >= 2) {
				// Keep periods in the generator (with double-completion scoring)
				// instead of dumping them to parking as isolated singles.
				array_unshift($lessonNeeds, [
					'assignment' => $need['assignment'],
					'block_size' => 1,
					'hours' => (int) $need['hours'],
				], [
					'assignment' => $need['assignment'],
					'block_size' => 1,
					'hours' => (int) $need['hours'],
				]);
			} elseif ($blockSize === 2 && $remaining === 1) {
				array_unshift($lessonNeeds, [
					'assignment' => $need['assignment'],
					'block_size' => 1,
					'hours' => (int) $need['hours'],
				]);
			} else {
				$assignment = $need['assignment'];
				$classLabel = TimetableClassLabel::fromRow($assignment);
				$teacher = trim((string) ($assignment['teacher_name'] ?? ''));
				$this->warnings[] = 'Could not place ' . ($assignment['course_title'] ?? 'course')
					. ' in ' . ($classLabel !== '' ? $classLabel : 'class')
					. ($teacher !== '' ? ' (' . $teacher . ')' : '')
					. ' — ' . $blockSize . ' period(s)';
			}
			$processed++;
			if ($this->progressHandler !== null && ($processed % 4 === 0 || $lessonNeeds === [])) {
				($this->progressHandler)($processed, max($totalNeeds, 1), count($lessonNeeds));
			}
		}

		return ['entries' => $entries, 'warnings' => $this->warnings];
	}

	/** @param list<array<string,mixed>> $lessonNeeds */
	private function sortLessonNeeds(array &$lessonNeeds): void
	{
		foreach ($lessonNeeds as $i => $need) {
			$lessonNeeds[$i]['candidate_count'] = $this->countPlacementCandidates(
				$need['assignment'],
				(int) $need['block_size'],
				(int) $need['hours']
			);
			$lessonNeeds[$i]['is_pe'] = $this->isPhysicalEducationSportCourse(
				(string) ($need['assignment']['course_title'] ?? '')
			) ? 1 : 0;
			$lessonNeeds[$i]['window_fill'] = (
				$this->secondaryCriteria !== null
				&& $this->secondaryCriteria->isWindowFillTeacher($need['assignment'])
			) ? 1 : 0;
		}
		usort($lessonNeeds, static function ($a, $b) {
			$win = (int) ($b['window_fill'] ?? 0) <=> (int) ($a['window_fill'] ?? 0);
			if ($win !== 0) {
				return $win;
			}
			$pe = (int) ($b['is_pe'] ?? 0) <=> (int) ($a['is_pe'] ?? 0);
			if ($pe !== 0) {
				return $pe;
			}
			$ca = (int) ($a['candidate_count'] ?? PHP_INT_MAX);
			$cb = (int) ($b['candidate_count'] ?? PHP_INT_MAX);
			if ($ca !== $cb) {
				return $ca <=> $cb;
			}
			$bs = (int) $b['block_size'] <=> (int) $a['block_size'];
			if ($bs !== 0) {
				return $bs;
			}
			$ha = (int) $a['hours'];
			$hb = (int) $b['hours'];
			if ($ha <= 2 && $hb > 2) {
				return -1;
			}
			if ($hb <= 2 && $ha > 2) {
				return 1;
			}
			return $hb <=> $ha;
		});
	}

	/** Fast sort for large batches — skip per-lesson candidate scans that freeze progress. */
	private function sortLessonNeedsLight(array &$lessonNeeds): void
	{
		foreach ($lessonNeeds as $i => $need) {
			$lessonNeeds[$i]['is_pe'] = $this->isPhysicalEducationSportCourse(
				(string) ($need['assignment']['course_title'] ?? '')
			) ? 1 : 0;
			$lessonNeeds[$i]['window_fill'] = (
				$this->secondaryCriteria !== null
				&& $this->secondaryCriteria->isWindowFillTeacher($need['assignment'])
			) ? 1 : 0;
		}
		usort($lessonNeeds, static function ($a, $b) {
			$win = (int) ($b['window_fill'] ?? 0) <=> (int) ($a['window_fill'] ?? 0);
			if ($win !== 0) {
				return $win;
			}
			$pe = (int) ($b['is_pe'] ?? 0) <=> (int) ($a['is_pe'] ?? 0);
			if ($pe !== 0) {
				return $pe;
			}
			$bs = (int) $b['block_size'] <=> (int) $a['block_size'];
			if ($bs !== 0) {
				return $bs;
			}
			return (int) $b['hours'] <=> (int) $a['hours'];
		});
	}

	/** @return list<string> */
	public function warnings(): array
	{
		return $this->warnings;
	}

	/**
	 * Mirror a placed lesson onto its combine-partner class (same day/slots).
	 *
	 * @param list<array<string,mixed>> $placed
	 * @param array<string,int> $placedByAssignment
	 * @return list<array<string,mixed>>
	 */
	private function placeCombinePartnerCopies(array $row, array $placed, array &$placedByAssignment): array
	{
		if ($this->secondaryCriteria === null || $placed === []) {
			return [];
		}
		$partners = $this->secondaryCriteria->combinePartners($row);
		if ($partners === []) {
			return [];
		}
		$out = [];
		foreach ($partners as $partner) {
			$copies = $this->copyPlacedToPartner($row, $partner, $placed, $placedByAssignment);
			foreach ($copies as $entry) {
				$out[] = $entry;
			}
		}
		return $out;
	}

	/**
	 * @param list<array<string,mixed>> $placed
	 * @param array<string,int> $placedByAssignment
	 * @return list<array<string,mixed>>
	 */
	private function copyPlacedToPartner(array $row, array $partner, array $placed, array &$placedByAssignment): array
	{
		$partnerKey = $this->assignmentQuotaKey($partner);
		$quota = self::weeklyHoursFromCourse($partner);
		$already = (int) ($placedByAssignment[$partnerKey] ?? 0);
		$room = max(0, $quota - $already);
		if ($room <= 0) {
			return [];
		}

		$classId = (int) ($partner['class_id'] ?? 0);
		$staffId = (int) ($partner['lecturer'] ?? 0);
		$sourceStaff = (int) ($row['lecturer'] ?? $row['staff_id'] ?? 0);
		$sameTeacher = $staffId > 0 && $staffId === $sourceStaff;
		$courseId = (int) ($partner['course_id'] ?? 0);
		$subjectKey = $classId . ':' . $courseId;
		$out = [];
		$day = (int) ($placed[0]['day_of_week'] ?? -1);
		$slotIds = [];
		foreach ($placed as $entry) {
			$sourceSlot = (int) ($entry['slot_id'] ?? 0);
			if ($sourceSlot <= 0) {
				continue;
			}
			$slotIds[] = $this->slotIdForClass($classId, $sourceSlot);
		}
		$slotIds = array_values(array_filter($slotIds));
		if ($day < 0 || $slotIds === [] || count($slotIds) > $room) {
			return [];
		}
		foreach ($slotIds as $slotId) {
			if (!empty($this->blocked[$day . ':' . $slotId])) {
				return [];
			}
			if (isset($this->classBusy[$this->busyKey($classId, $day, $slotId)])) {
				return [];
			}
			// Same teacher is already in this period — that is the combine, not a clash.
			if (!$sameTeacher && $staffId > 0 && $this->staffHasTimeConflict($staffId, $day, $slotId)) {
				return [];
			}
			if (!$this->criteriaAllowsSlot($partner, $day, $slotId)) {
				return [];
			}
		}

		foreach ($slotIds as $slotId) {
			$this->classBusy[$this->busyKey($classId, $day, $slotId)] = true;
			$this->classDayUsage[$classId . ':' . $day] = (int) ($this->classDayUsage[$classId . ':' . $day] ?? 0) + 1;
			$this->globalDayUsage[$day] = (int) ($this->globalDayUsage[$day] ?? 0) + 1;
			if ($staffId > 0 && !$sameTeacher) {
				$this->staffBusy[$this->busyStaffKey($staffId, $day, $slotId)] = true;
				$range = $this->slotTimeRange($slotId);
				if ($range !== null) {
					$this->staffTimeBookings[$staffId][$day][] = $range;
				}
			}
			$out[] = [
				'class_id' => $classId,
				'staff_id' => $staffId,
				'course_id' => $courseId,
				'course_record_id' => (int) ($partner['course_record_id'] ?? 0),
				'day_of_week' => $day,
				'slot_id' => $slotId,
				'entry_type' => 'lesson',
			];
		}
		$this->subjectDayCount[$subjectKey . ':' . $day] =
			(int) ($this->subjectDayCount[$subjectKey . ':' . $day] ?? 0) + count($slotIds);
		$placedByAssignment[$partnerKey] = $already + count($out);

		return $out;
	}

	private function criteriaAllowsSlot(array $row, int $day, int $slotId): bool
	{
		if ($day === 6 && $this->secondaryCriteria === null) {
			return false;
		}
		if ($this->secondaryCriteria === null) {
			return true;
		}
		$times = $this->slotTimes[$slotId] ?? null;
		return $this->secondaryCriteria->slotAllowed(
			$row,
			$day,
			$times['start'] ?? null,
			$times['end'] ?? null
		);
	}

	/** @return list<array<string,mixed>>|null */
	private function placeLesson(array $row, int $blockSize, int $weeklyHours = 0): ?array
	{
		$classId = (int) ($row['class_id'] ?? 0);
		$staffId = (int) ($row['lecturer'] ?? 0);
		$courseId = (int) ($row['course_id'] ?? 0);
		$subjectKey = $classId . ':' . $courseId;
		$maxPerDay = $this->maxPerDayForCourse($row, $weeklyHours);
		$occupiedDays = $this->subjectOccupiedDays($subjectKey);
		$enforceGap = $this->requiresNonAdjacentDays($row, $weeklyHours) && $occupiedDays !== [];
		$peSport = $this->isPhysicalEducationSportCourse((string) ($row['course_title'] ?? ''));
		$lastHour = $peSport || ($this->secondaryCriteria !== null && $this->secondaryCriteria->prefersLastHour($row));
		$afterLessons = $this->secondaryCriteria !== null && $this->secondaryCriteria->requiresAfterLessons($row);
		// Prefer last periods first; widen only if the PE / last-hour course has no free late slot.
		// Other courses must fill morning before any afternoon slot.
		$windows = $lastHour ? [2, 3, 4, 5, 6, 7, 0] : [0];

		$candidates = [];
		foreach ($windows as $window) {
			$morningFirst = !$lastHour && !$afterLessons && $window === 0;
			$candidates = $this->collectPlacementCandidates(
				$row,
				$blockSize,
				$weeklyHours,
				$maxPerDay,
				$enforceGap,
				$window,
				$morningFirst
			);
			if ($candidates === [] && $morningFirst) {
				$candidates = $this->collectPlacementCandidates(
					$row,
					$blockSize,
					$weeklyHours,
					$maxPerDay,
					$enforceGap,
					$window,
					false
				);
			}
			if ($candidates === [] && $enforceGap) {
				$candidates = $this->collectPlacementCandidates(
					$row,
					$blockSize,
					$weeklyHours,
					$maxPerDay,
					false,
					$window,
					$morningFirst
				);
				if ($candidates === [] && $morningFirst) {
					$candidates = $this->collectPlacementCandidates(
						$row,
						$blockSize,
						$weeklyHours,
						$maxPerDay,
						false,
						$window,
						false
					);
				}
			}
			if ($candidates !== []) {
				break;
			}
		}

		if ($candidates === []) {
			return null;
		}

		usort($candidates, static function ($a, $b) {
			return $a['score'] <=> $b['score'];
		});

		$pick = $candidates[0];
		$out = [];
		foreach ($pick['slot_ids'] as $slotId) {
			$this->markBusy($classId, $staffId, $pick['day'], $slotId);
			$out[] = [
				'class_id' => $classId,
				'staff_id' => $staffId,
				'course_id' => $courseId,
				'course_record_id' => (int) ($row['course_record_id'] ?? 0),
				'day_of_week' => $pick['day'],
				'slot_id' => $slotId,
				'entry_type' => 'lesson',
			];
		}
		$this->subjectDayCount[$subjectKey . ':' . $pick['day']] =
			(int) ($this->subjectDayCount[$subjectKey . ':' . $pick['day']] ?? 0) + count($pick['slot_ids']);

		return $out;
	}

	/**
	 * @param int $endOfDayWindow 0 = any slot; N = only last N teaching periods
	 * @return list<array{score:int,day:int,slot_ids:list<int>}>
	 */
	private function collectPlacementCandidates(
		array $row,
		int $blockSize,
		int $weeklyHours,
		int $maxPerDay,
		bool $enforceNonAdjacentDays,
		int $endOfDayWindow = 0,
		bool $morningOnly = false
	): array {
		$classId = (int) ($row['class_id'] ?? 0);
		$staffId = (int) ($row['lecturer'] ?? 0);
		$courseId = (int) ($row['course_id'] ?? 0);
		$subjectKey = $classId . ':' . $courseId;
		$occupiedDays = $this->subjectOccupiedDays($subjectKey);
		$peSport = $this->isPhysicalEducationSportCourse((string) ($row['course_title'] ?? ''));
		$lastHour = $peSport || ($this->secondaryCriteria !== null && $this->secondaryCriteria->prefersLastHour($row));
		$afterLessons = $this->secondaryCriteria !== null && $this->secondaryCriteria->requiresAfterLessons($row);
		$candidates = [];
		$slotCount = count($this->teachingSlots);
		$reserveLate = $slotCount > 0 ? max(0, $slotCount - 3) : 0;
		$lateStartIndex = 0;
		if ($endOfDayWindow > 0 && $slotCount > 0) {
			$lateStartIndex = max(0, $slotCount - max($endOfDayWindow, $blockSize));
		}

		$orderedDays = $this->days;
		usort($orderedDays, function ($a, $b) use ($classId) {
			$ma = $this->classMorningFreeCount($classId, (int) $a);
			$mb = $this->classMorningFreeCount($classId, (int) $b);
			if ($ma !== $mb) {
				return $mb <=> $ma;
			}
			$ua = (int) ($this->classDayUsage[$classId . ':' . $a] ?? 0);
			$ub = (int) ($this->classDayUsage[$classId . ':' . $b] ?? 0);
			if ($ua !== $ub) {
				return $ua <=> $ub;
			}
			return (int) ($this->globalDayUsage[$a] ?? 0) <=> (int) ($this->globalDayUsage[$b] ?? 0);
		});

		foreach ($orderedDays as $day) {
			$already = (int) ($this->subjectDayCount[$subjectKey . ':' . $day] ?? 0);
			if ($already + $blockSize > $maxPerDay) {
				continue;
			}
			if ($enforceNonAdjacentDays && $this->dayTouchesOccupiedDays($day, $occupiedDays)) {
				continue;
			}
			for ($i = 0; $i < $slotCount; $i++) {
				if ($endOfDayWindow > 0 && $i < $lateStartIndex) {
					continue;
				}
				if ($morningOnly && !$this->slotIsMorning($this->teachingSlots[$i] ?? [])) {
					continue;
				}
				if ($blockSize === 2) {
					for ($j = $i + 1; $j < $slotCount; $j++) {
						if ($endOfDayWindow > 0 && $j < $lateStartIndex) {
							continue;
						}
						if ($morningOnly && !$this->slotIsMorning($this->teachingSlots[$j] ?? [])) {
							continue;
						}
						$slotA = (int) $this->teachingSlots[$i]['id'];
						$slotB = (int) $this->teachingSlots[$j]['id'];
						if (!$this->slotsTemporallyAdjacent($slotA, $slotB)) {
							continue;
						}
						$slotIds = [$slotA, $slotB];
						if (!$this->slotsFree($classId, $staffId, $day, $slotIds, $row)) {
							continue;
						}
						if (!$this->combinePartnerSlotsFree($row, $day, $slotIds)) {
							continue;
						}
						$score = $this->scorePlacement($classId, $staffId, $courseId, $day, $j, $weeklyHours, $row);
						if ($j !== $i + 1) {
							$score += 15;
						}
						if ($lastHour) {
							$score += ($slotCount - 1 - $j) * 800;
						} elseif (!$afterLessons && $j >= $reserveLate) {
							$score += 900;
						}
						$candidates[] = ['score' => $score, 'day' => $day, 'slot_ids' => $slotIds];
					}
					continue;
				}

				$slotIds = [(int) $this->teachingSlots[$i]['id']];
				if (!$this->slotsFree($classId, $staffId, $day, $slotIds, $row)) {
					continue;
				}
				if (!$this->combinePartnerSlotsFree($row, $day, $slotIds)) {
					continue;
				}

				$score = $this->scorePlacement($classId, $staffId, $courseId, $day, $i, $weeklyHours, $row);
				if ($lastHour) {
					$score += ($slotCount - 1 - $i) * 800;
				} elseif (!$afterLessons && $i >= $reserveLate) {
					$score += 900;
				}
				$candidates[] = ['score' => $score, 'day' => $day, 'slot_ids' => $slotIds];
			}
		}

		return $candidates;
	}

	private function scorePlacement(
		int $classId,
		int $staffId,
		int $courseId,
		int $day,
		int $slotIndex,
		int $weeklyHours = 0,
		array $row = []
	): int {
		$score = (int) ($this->classDayUsage[$classId . ':' . $day] ?? 0) * 80;
		$score += (int) ($this->globalDayUsage[$day] ?? 0) * 15;
		$peSport = $this->isPhysicalEducationSportCourse((string) ($row['course_title'] ?? ''));
		$lastHour = $peSport || ($this->secondaryCriteria !== null && $this->secondaryCriteria->prefersLastHour($row));
		$afterLessons = $this->secondaryCriteria !== null && $this->secondaryCriteria->requiresAfterLessons($row);
		$slot = $this->teachingSlots[$slotIndex] ?? [];
		if ($lastHour || $afterLessons) {
			$score += 0;
		} elseif ($this->slotIsMorning($slot)) {
			$score -= 2500 + max(0, 12 * 60 - $this->clockMinutes((string) ($slot['start_time'] ?? '')));
		} else {
			$score += 5000 + $this->classMorningFreeCount($classId, $day) * 800;
		}

		$subjectKey = $classId . ':' . $courseId;
		$sameDayPenalty = ($weeklyHours > 0 && $weeklyHours <= 2) ? 200 : 40;
		$occupied = $this->subjectOccupiedDays($subjectKey);
		$gapCourse = $this->requiresNonAdjacentDays($row, $weeklyHours);

		// Anchor multi-hour secondary courses on Mon/Wed/Fri so later blocks can gap.
		if ($gapCourse && $occupied === []) {
			$score += in_array($day, [0, 2, 4], true) ? -70 : 55;
		}

		// Prefer completing a same-day pair (turn two singles into a double).
		if ($gapCourse) {
			$onThisDay = (int) ($this->subjectDayCount[$subjectKey . ':' . $day] ?? 0);
			if ($onThisDay === 1) {
				$score -= 900;
			}
		}

		foreach ($occupied as $d) {
			if ($d === $day) {
				$score += $sameDayPenalty;
				continue;
			}
			$dist = abs($day - (int) $d);
			$score -= min(30, $dist * 10);
			if ($gapCourse && $dist === 1) {
				// Strongly prefer gap days (Mon↔Wed) over neighbour days (Mon↔Tue).
				$score += 5000;
			}
		}

		if ($this->secondaryCriteria !== null) {
			$slot = $this->teachingSlots[$slotIndex] ?? null;
			$score += $this->secondaryCriteria->morningScoreDelta(
				$row,
				isset($slot['start_time']) ? (string) $slot['start_time'] : null,
				isset($slot['end_time']) ? (string) $slot['end_time'] : null
			);
			$score += $this->secondaryCriteria->sundayScoreDelta($row, $day);
			$score += $this->secondaryCriteria->afterLessonScoreDelta(
				$row,
				isset($slot['start_time']) ? (string) $slot['start_time'] : null,
				isset($slot['end_time']) ? (string) $slot['end_time'] : null
			);
			$score += $this->namedWindowFillScore($row, $day, $slotIndex);
		}

		return $score;
	}

	private function namedWindowFillScore(array $row, int $day, int $slotIndex): int
	{
		if ($this->secondaryCriteria === null) {
			return 0;
		}
		$bands = $this->secondaryCriteria->fillPriorityBands($row);
		if ($bands === []) {
			return 0;
		}
		$slot = $this->teachingSlots[$slotIndex] ?? [];
		$start = $this->clockMinutes((string) ($slot['start_time'] ?? ''));
		$end = $this->clockMinutes((string) ($slot['end_time'] ?? ''));
		$thisPriority = 99;
		foreach ($bands as $band) {
			if ((int) $band['day'] === $day && $start >= (int) $band['start'] && $end <= (int) $band['end']) {
				$thisPriority = min($thisPriority, (int) $band['priority']);
			}
		}
		if ($thisPriority === 99) {
			return 20000;
		}
		$staffId = (int) ($row['lecturer'] ?? $row['staff_id'] ?? 0);
		foreach ($bands as $band) {
			if ((int) $band['priority'] >= $thisPriority) {
				continue;
			}
			$cap = $this->secondaryCriteria->countSlotsInBand($band, $this->teachingSlots);
			$filled = $this->countStaffFilledInBand($staffId, $band);
			if ($cap > 0 && $filled < $cap) {
				return 15000 + ($thisPriority * 2000);
			}
		}

		return ($thisPriority - 1) * 400;
	}

	/** @param array{day:int,start:int,end:int} $band */
	private function countStaffFilledInBand(int $staffId, array $band): int
	{
		if ($staffId <= 0) {
			return 0;
		}
		$day = (int) ($band['day'] ?? -1);
		$count = 0;
		foreach ($this->teachingSlots as $slot) {
			if (!empty($slot['is_break'])) {
				continue;
			}
			$slotId = (int) ($slot['id'] ?? 0);
			if ($slotId <= 0) {
				continue;
			}
			$start = $this->clockMinutes((string) ($slot['start_time'] ?? ''));
			$end = $this->clockMinutes((string) ($slot['end_time'] ?? ''));
			if ($end <= $start || $start < (int) $band['start'] || $end > (int) $band['end']) {
				continue;
			}
			if (isset($this->staffBusy[$this->busyStaffKey($staffId, $day, $slotId)])) {
				$count++;
			}
		}
		return $count;
	}

	/** @param list<int> $slotIds */
	private function combinePartnerSlotsFree(array $row, int $day, array $slotIds): bool
	{
		if ($this->secondaryCriteria === null) {
			return true;
		}
		$partners = $this->secondaryCriteria->combinePartners($row);
		if ($partners === []) {
			return true;
		}
		$sourceStaff = (int) ($row['lecturer'] ?? $row['staff_id'] ?? 0);
		foreach ($partners as $partner) {
			$partnerClass = (int) ($partner['class_id'] ?? 0);
			$partnerStaff = (int) ($partner['lecturer'] ?? 0);
			$sameTeacher = $partnerStaff > 0 && $partnerStaff === $sourceStaff;
			foreach ($slotIds as $slotId) {
				$partnerSlot = $this->slotIdForClass($partnerClass, (int) $slotId);
				if (isset($this->classBusy[$this->busyKey($partnerClass, $day, $partnerSlot)])) {
					return false;
				}
				if (!$this->criteriaAllowsSlot($partner, $day, $partnerSlot)) {
					return false;
				}
				if (!$sameTeacher && $partnerStaff > 0 && $this->staffHasTimeConflict($partnerStaff, $day, $partnerSlot)) {
					return false;
				}
			}
		}
		return true;
	}

	private function countPlacementCandidates(array $row, int $blockSize, int $weeklyHours = 0): int
	{
		$maxPerDay = $this->maxPerDayForCourse($row, $weeklyHours);
		$subjectKey = (int) ($row['class_id'] ?? 0) . ':' . (int) ($row['course_id'] ?? 0);
		$occupied = $this->subjectOccupiedDays($subjectKey);
		$enforce = $this->requiresNonAdjacentDays($row, $weeklyHours) && $occupied !== [];
		$peSport = $this->isPhysicalEducationSportCourse((string) ($row['course_title'] ?? ''));
		$afterLessons = $this->secondaryCriteria !== null && $this->secondaryCriteria->requiresAfterLessons($row);
		$windows = $peSport ? [2, 3, 4, 5, 6, 7, 0] : [0];
		foreach ($windows as $window) {
			$morningFirst = !$peSport && !$afterLessons && $window === 0;
			$count = count($this->collectPlacementCandidates($row, $blockSize, $weeklyHours, $maxPerDay, $enforce, $window, $morningFirst));
			if ($count === 0 && $morningFirst) {
				$count = count($this->collectPlacementCandidates($row, $blockSize, $weeklyHours, $maxPerDay, $enforce, $window, false));
			}
			if ($count === 0 && $enforce) {
				$count = count($this->collectPlacementCandidates($row, $blockSize, $weeklyHours, $maxPerDay, false, $window, $morningFirst));
				if ($count === 0 && $morningFirst) {
					$count = count($this->collectPlacementCandidates($row, $blockSize, $weeklyHours, $maxPerDay, false, $window, false));
				}
			}
			if ($count > 0) {
				return $count;
			}
		}
		return 0;
	}

	/** @param list<int> $slotIds */
	private function slotsFree(int $classId, int $staffId, int $day, array $slotIds, array $row = []): bool
	{
		foreach ($slotIds as $slotId) {
			if (!empty($this->blocked[$day . ':' . $slotId])) {
				return false;
			}
			if (isset($this->classBusy[$this->busyKey($classId, $day, $slotId)])) {
				return false;
			}
			if ($staffId > 0 && $this->staffHasTimeConflict($staffId, $day, $slotId)) {
				return false;
			}
			if ($row !== [] && !$this->criteriaAllowsSlot($row, $day, (int) $slotId)) {
				return false;
			}
		}
		return true;
	}

	private function staffHasTimeConflict(int $staffId, int $day, int $slotId): bool
	{
		if (isset($this->staffBusy[$this->busyStaffKey($staffId, $day, $slotId)])) {
			return true;
		}
		$range = $this->slotTimeRange($slotId);
		if ($range === null) {
			return false;
		}
		foreach ($this->staffTimeBookings[$staffId][$day] ?? [] as $booked) {
			if ($this->rangesOverlap($range['start'], $range['end'], $booked['start'], $booked['end'])) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Keep other levels' lessons busy so a level-only regenerate cannot double-book teachers.
	 *
	 * @param list<array<string,mixed>> $entries
	 * @param array<int,array{start:string,end:string}> $slotTimesById
	 */
	/**
	 * @param list<array<string,mixed>>|array<int,array{start?:string,end?:string}> $slotsOrById
	 */
	public function mergeSlotTimes(array $slotsOrById): void
	{
		foreach ($slotsOrById as $key => $slot) {
			if (!is_array($slot)) {
				continue;
			}
			$id = (int) ($slot['id'] ?? $key);
			if ($id <= 0) {
				continue;
			}
			$start = (string) ($slot['start'] ?? $slot['start_time'] ?? '');
			$end = (string) ($slot['end'] ?? $slot['end_time'] ?? '');
			if ($start === '' && $end === '') {
				continue;
			}
			$this->slotTimes[$id] = [
				'start' => $start !== '' ? $start : '00:00:00',
				'end' => $end !== '' ? $end : '00:00:00',
			];
		}
	}

	public function seedBusyFromEntries(array $entries, array $slotTimesById = []): void
	{
		$this->mergeSlotTimes($slotTimesById);
		foreach ($entries as $entry) {
			$day = (int) ($entry['day_of_week'] ?? -1);
			$slotId = (int) ($entry['slot_id'] ?? 0);
			if ($day < 0 || $slotId <= 0) {
				continue;
			}
			if (!isset($this->slotTimes[$slotId]) && !empty($entry['start_time'])) {
				$this->slotTimes[$slotId] = [
					'start' => (string) $entry['start_time'],
					'end' => (string) ($entry['end_time'] ?? '00:00:00'),
				];
			}
			$this->markBusy(
				(int) ($entry['class_id'] ?? 0),
				(int) ($entry['staff_id'] ?? 0),
				$day,
				$slotId
			);
			$classId = (int) ($entry['class_id'] ?? 0);
			$courseId = (int) ($entry['course_id'] ?? 0);
			if ($classId > 0 && $courseId > 0) {
				$subjectKey = $classId . ':' . $courseId . ':' . $day;
				$this->subjectDayCount[$subjectKey] = (int) ($this->subjectDayCount[$subjectKey] ?? 0) + 1;
			}
		}
	}

	private function markBusy(int $classId, int $staffId, int $day, int $slotId): void
	{
		$this->classBusy[$this->busyKey($classId, $day, $slotId)] = true;
		$this->classDayUsage[$classId . ':' . $day] = (int) ($this->classDayUsage[$classId . ':' . $day] ?? 0) + 1;
		$this->globalDayUsage[$day] = (int) ($this->globalDayUsage[$day] ?? 0) + 1;
		if ($staffId > 0) {
			$this->staffBusy[$this->busyStaffKey($staffId, $day, $slotId)] = true;
			$range = $this->slotTimeRange($slotId);
			if ($range !== null) {
				$this->staffTimeBookings[$staffId][$day][] = $range;
			}
		}
	}

	/** @return array{start:int,end:int}|null */
	private function slotTimeRange(int $slotId): ?array
	{
		$times = $this->slotTimes[$slotId] ?? null;
		if ($times === null) {
			return null;
		}
		return [
			'start' => $this->timeToMinutes($times['start']),
			'end' => $this->timeToMinutes($times['end']),
		];
	}

	public static function isMorningClock(?string $startTime): bool
	{
		$start = trim((string) $startTime);
		if ($start === '') {
			return false;
		}
		return self::clockMinutesFromString($start) < 12 * 60;
	}

	/** @param array<string,mixed> $slot */
	private function slotIsMorning(array $slot): bool
	{
		return self::isMorningClock((string) ($slot['start_time'] ?? ''));
	}

	private function clockMinutes(string $time): int
	{
		return self::clockMinutesFromString($time);
	}

	public static function clockMinutesFromString(string $time): int
	{
		$parts = explode(':', substr($time, 0, 8));
		return ((int) ($parts[0] ?? 0)) * 60 + (int) ($parts[1] ?? 0);
	}

	private function classMorningFreeCount(int $classId, int $day): int
	{
		$free = 0;
		foreach ($this->teachingSlots as $slot) {
			if (!empty($slot['is_break']) || !$this->slotIsMorning($slot)) {
				continue;
			}
			$slotId = (int) ($slot['id'] ?? 0);
			if ($slotId <= 0 || !empty($this->blocked[$day . ':' . $slotId])) {
				continue;
			}
			if (!isset($this->classBusy[$this->busyKey($classId, $day, $slotId)])) {
				$free++;
			}
		}
		return $free;
	}

	private function timeToMinutes(string $time): int
	{
		return self::clockMinutesFromString($time);
	}

	private function rangesOverlap(int $aStart, int $aEnd, int $bStart, int $bEnd): bool
	{
		return $aStart < $bEnd && $bStart < $aEnd;
	}

	/**
	 * True when two teaching slots form a usable double.
	 * Allows short changeover/tea break (<=25 min) but not lunch (>=45 min).
	 */
	private function slotsTemporallyAdjacent(int $slotA, int $slotB): bool
	{
		$a = $this->slotTimeRange($slotA);
		$b = $this->slotTimeRange($slotB);
		if ($a === null || $b === null) {
			return true;
		}
		$gap = min(abs($a['end'] - $b['start']), abs($b['end'] - $a['start']));
		return $gap <= 25;
	}

	private function busyKey(int $classId, int $day, int $slotId): string
	{
		return 'c' . $classId . 'd' . $day . 's' . $slotId;
	}

	private function busyStaffKey(int $staffId, int $day, int $slotId): string
	{
		return 't' . $staffId . 'd' . $day . 's' . $slotId;
	}

	/** @return list<int> */
	private function lessonBlocksForCourse(array $row, int $hours): array
	{
		if ($hours <= 0) {
			return [];
		}
		if ($this->requiresSpreadAcrossDays($row)) {
			return array_fill(0, $hours, 1);
		}
		return self::distributeWeeklyHours($hours);
	}

	private function maxPerDayForCourse(array $row, int $weeklyHours): int
	{
		if ($this->secondaryCriteria !== null) {
			$peMax = $this->secondaryCriteria->peMaxPerDay($row, $weeklyHours);
			if ($peMax !== null) {
				return $peMax;
			}
		}
		if ($this->requiresSpreadAcrossDays($row)) {
			return 1;
		}
		$fallback = ($weeklyHours > 0 && $weeklyHours <= 2) ? 1 : 2;
		if ($this->secondaryCriteria !== null) {
			return $this->secondaryCriteria->packedDailyCap($row, $weeklyHours, $fallback);
		}
		return $fallback;
	}

	private function requiresSpreadAcrossDays(array $row): bool
	{
		// Document: 2-period subjects stay as two singles; PE at most one period per day.
		if ($this->isPhysicalEducationSportCourse((string) ($row['course_title'] ?? ''))) {
			return true;
		}
		return self::weeklyHoursFromCourse($row) === 2;
	}

	/** Secondary classes with 3+ weekly periods: doubles + non-adjacent days. */
	private function requiresNonAdjacentDays(array $row, int $weeklyHours): bool
	{
		if ($this->isPrimaryOrNursery($row) || $weeklyHours < 3) {
			return false;
		}
		if ($this->secondaryCriteria !== null) {
			$staffId = (int) ($row['lecturer'] ?? $row['staff_id'] ?? 0);
			if ($this->secondaryCriteria->hasOrderedFillWindows($row)
				|| $this->secondaryCriteria->isHeavyStaff($staffId)
				|| $this->secondaryCriteria->isPersonalRestrictionRelaxed($staffId, (string) ($row['teacher_name'] ?? ''))) {
				return false;
			}
			$days = $this->secondaryCriteria->restrictedTeachingDays($row);
			if (is_array($days) && count($days) < 3) {
				return false;
			}
		}
		return true;
	}

	/** @return list<int> */
	private function subjectOccupiedDays(string $subjectKey): array
	{
		$out = [];
		foreach ($this->days as $day) {
			if ((int) ($this->subjectDayCount[$subjectKey . ':' . $day] ?? 0) > 0) {
				$out[] = (int) $day;
			}
		}
		return $out;
	}

	/** @param list<int> $occupied */
	private function dayTouchesOccupiedDays(int $day, array $occupied): bool
	{
		foreach ($occupied as $od) {
			if ((int) $od === $day || $this->isCalendarAdjacentDay($day, (int) $od)) {
				return true;
			}
		}
		return false;
	}

	private function isCalendarAdjacentDay(int $a, int $b): bool
	{
		return abs($a - $b) === 1;
	}

	private function isPrimaryOrNursery(array $row): bool
	{
		$track = strtolower(trim((string) ($row['_track_key'] ?? $row['track_key'] ?? '')));
		return in_array($track, ['primary', 'nursery'], true);
	}

	/**
	 * Only the lowest class id in this generate batch places; partners are copied.
	 *
	 * @param array<int,bool> $batchClassIds
	 */
	private function isCombineFollowerInBatch(array $row, array $batchClassIds): bool
	{
		if ($this->secondaryCriteria === null) {
			return false;
		}
		$partners = $this->secondaryCriteria->combinePartners($row);
		if ($partners === []) {
			return false;
		}
		// Phase-wide leader (lowest class id) places once; partners only receive copies.
		// Do not require the leader to be in this track batch — O Level / A Level
		// / TVET generate separately but still share one teacher period.
		$my = (int) ($row['class_id'] ?? 0);
		$ids = [$my];
		foreach ($partners as $partner) {
			$pid = (int) ($partner['class_id'] ?? 0);
			if ($pid > 0) {
				$ids[] = $pid;
			}
		}
		$ids = array_values(array_unique(array_filter($ids)));
		if (count($ids) < 2) {
			return false;
		}
		return $my !== min($ids);
	}

	private function slotIdForClass(int $classId, int $sourceSlotId): int
	{
		if ($classId <= 0 || $sourceSlotId <= 0) {
			return $sourceSlotId;
		}
		$times = $this->slotTimes[$sourceSlotId] ?? null;
		if ($times === null) {
			return $sourceSlotId;
		}
		$track = (string) ($this->classTracks[$classId] ?? '');
		if ($track === '') {
			return $sourceSlotId;
		}
		$key = $this->clockKey((string) ($times['start'] ?? ''), (string) ($times['end'] ?? ''));
		$mapped = (int) ($this->trackClockSlots[$track][$key] ?? 0);
		return $mapped > 0 ? $mapped : $sourceSlotId;
	}

	private function clockKey(string $start, string $end): string
	{
		return \App\Models\TimetableSchemaModel::slotClock($start)
			. '|' . \App\Models\TimetableSchemaModel::slotClock($end);
	}

	private function assignmentQuotaKey(array $row): string
	{
		$cr = (int) ($row['course_record_id'] ?? 0);
		if ($cr > 0) {
			return 'cr:' . $cr;
		}
		return 'c:' . (int) ($row['class_id'] ?? 0)
			. ':' . (int) ($row['course_id'] ?? 0)
			. ':' . (int) ($row['lecturer'] ?? 0);
	}

	private function isMathematicsCourse(string $title): bool
	{
		$title = strtolower(trim(preg_replace('/\s+/', ' ', $title)));
		return $title !== '' && (strpos($title, 'mathematics') !== false || preg_match('/\bmath\b/', $title) === 1);
	}

	/** Physical Education / Sport — schedule at the last periods of the day. */
	public static function isPhysicalEducationSportTitle(string $title): bool
	{
		$t = strtolower(trim(preg_replace('/\s+/', ' ', $title)));
		if ($t === '') {
			return false;
		}
		if (preg_match('/\bpes\b/', $t) === 1) {
			return true;
		}
		if (strpos($t, 'physica') !== false && strpos($t, 'sport') !== false) {
			return true;
		}
		if (strpos($t, 'physical') !== false && strpos($t, 'sport') !== false) {
			return true;
		}
		if (strpos($t, 'physical education') !== false || strpos($t, 'physica education') !== false) {
			return true;
		}
		return $t === 'sport' || $t === 'sports' || $t === 'pe';
	}

	private function isPhysicalEducationSportCourse(string $title): bool
	{
		return self::isPhysicalEducationSportTitle($title);
	}
}
