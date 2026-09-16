<?php
/** @var string $subtitle */
/** @var string $title */
/** @var list<string> $day_labels */
/** @var list<array{slot:array,cells:array}> $grid */
/** @var string $mode */
/** @var bool $for_pdf */
/** @var bool $editable */
/** @var int $schedule_id */
/** @var array<string,int> $day_map */
/** @var list<array<string,mixed>> $staging_entries */
/** @var array<int,bool> $conflict_entry_ids */
$schoolName = strtoupper($school_name ?? 'SCHOOL');
$editable = !empty($editable) && empty($for_pdf);
$isNurserySheet = strtolower((string) ($track_key ?? '')) === 'nursery';
if (!$isNurserySheet) {
	foreach ($grid ?? [] as $row) {
		foreach (($row['cells'] ?? []) as $cell) {
			if (!empty($cell['nursery_bg'])) {
				$isNurserySheet = true;
				break 2;
			}
		}
	}
}
$ttRange = static function ($start, $end) {
	return substr((string) $start, 0, 5) . ' - ' . substr((string) $end, 0, 5);
};
$conflictIds = $conflict_entry_ids ?? [];
?>
<div class="tt-sheet<?= $editable ? ' tt-sheet-editable' : ''; ?><?= $isNurserySheet ? ' tt-sheet-nursery' : ''; ?>"
	<?php if ($editable): ?>
	data-schedule-id="<?= (int) ($schedule_id ?? 0); ?>"
	data-mode="<?= esc($mode ?? 'class'); ?>"
	data-check-url="<?= site_url('timetable/check_move'); ?>"
	data-move-url="<?= site_url('timetable/move_entry'); ?>"
	<?php endif; ?>>

	<?php if ($editable): ?>
	<div class="tt-edit-toolbar mb-2">
		<span class="badge badge-info"><i class="fa fa-arrows"></i> Live edit</span>
		<span class="small text-muted ml-2">Green = free slot · Blue = occupied · Drop on the parking lot to unschedule</span>
	</div>
	<div class="tt-staging-dock tt-staging-parking mb-2" id="ttStagingDock" data-drop-zone="parking">
		<div class="tt-staging-label"><i class="fa fa-inbox"></i> Parking lot — drop lessons here to unschedule, then drag them into the bottom area or a free cell</div>
		<div class="tt-staging-items tt-staging-items-mirror">
			<div class="tt-staging-placeholder">Drop a lesson from the grid here to unschedule it</div>
		</div>
	</div>
	<div class="tt-conflict-banner alert alert-danger d-none" id="ttConflictBanner"></div>
	<?php endif; ?>

	<?php if (!empty($for_pdf) && !empty($letterhead)): ?>
		<?= view('pages/timetable/_letterhead', get_defined_vars()); ?>
	<?php else: ?>
		<div class="tt-sheet-head">
			<div class="tt-school"><?= esc($schoolName); ?></div>
			<div class="tt-sheet-title"><?= esc($subtitle); ?></div>
			<div class="tt-entity-name"><?= esc($title); ?></div>
			<?php if (!empty($generated_at)): ?>
				<div class="tt-meta">Timetable generated: <?= esc(date('n/j/Y', strtotime($generated_at))); ?></div>
			<?php endif; ?>
		</div>
	<?php endif; ?>

	<?php if (empty($schedule)): ?>
		<div class="alert alert-warning">No timetable for this term. <a href="<?= site_url('timetable/dashboard'); ?>">Generate one</a>.</div>
	<?php else: ?>
		<div class="tt-grid-wrap">
			<table class="tt-grid">
				<thead>
				<tr>
					<th class="tt-time-col"></th>
					<?php foreach ($day_labels as $dl): ?>
						<th><?= esc($dl); ?></th>
					<?php endforeach; ?>
				</tr>
				</thead>
				<tbody>
				<?php foreach ($grid as $row):
					$slot = $row['slot'];
					if (!empty($slot['is_break'])): ?>
						<tr class="tt-break-row">
							<td class="tt-time"><?= esc($ttRange($slot['start_time'], $slot['end_time'])); ?></td>
							<td colspan="<?= count($day_labels); ?>" class="tt-break-label"><?= esc($slot['break_label'] ?: $slot['label']); ?></td>
						</tr>
					<?php else: ?>
						<tr>
							<td class="tt-time">
								<div class="tt-period-num"><?= esc($slot['label']); ?></div>
								<div class="tt-period-range"><?= esc($ttRange($slot['start_time'], $slot['end_time'])); ?></div>
							</td>
							<?php foreach ($day_labels as $dl):
								$cell = $row['cells'][$dl] ?? null;
								$isSpecial = !empty($cell['type']) && $cell['type'] === 'special';
								$isLesson = !empty($cell['type']) && $cell['type'] === 'lesson';
								$isEmpty = !$isSpecial && !$isLesson;
								$color = $cell['color'] ?? 'yellow';
								$entryId = (int) ($cell['entry_id'] ?? 0);
								$hasConflict = $entryId > 0 && !empty($conflictIds[$entryId]);
								$dayNum = (int) ($cell['day'] ?? ($day_map[$dl] ?? 0));
								$slotId = (int) ($cell['slot_id'] ?? ($slot['id'] ?? 0));
								$cellClasses = ['tt-cell'];
								if ($isSpecial) {
									$cellClasses[] = 'tt-special-cell tt-special-' . esc($color);
								} elseif ($isLesson) {
									$cellClasses[] = 'tt-lesson-cell tt-cell-occupied';
									if (!empty($cell['nursery_bg'])) {
										$cellClasses[] = 'tt-nursery-colored';
									}
									if ($editable) {
										$cellClasses[] = 'tt-draggable-lesson';
									}
									if ($hasConflict) {
										$cellClasses[] = 'tt-has-conflict';
									}
								} elseif ($editable && $isEmpty) {
									$cellClasses[] = 'tt-drop-target tt-cell-free';
								}
								?>
								<td class="<?= implode(' ', $cellClasses); ?>"
									<?php if (!empty($cell['nursery_bg'])): ?>
									style="background:<?= esc($cell['nursery_bg']); ?>;color:<?= esc($cell['nursery_fg'] ?? '#1e293b'); ?>;"
									<?php endif; ?>
									<?php if ($editable && ($isLesson || $isEmpty)): ?>
									data-day="<?= $dayNum; ?>"
									data-slot-id="<?= $slotId; ?>"
									<?php endif; ?>
									<?php if ($isLesson && $editable): ?>
									draggable="true"
									data-entry-id="<?= $entryId; ?>"
									data-staff-id="<?= (int) ($cell['staff_id'] ?? 0); ?>"
									data-class-id="<?= (int) ($cell['class_id'] ?? 0); ?>"
									<?php endif; ?>>
									<?php if ($cell && ($isSpecial || $isLesson)): ?>
										<?php if ($isSpecial): ?>
											<div class="tt-special-label"><?= esc($cell['course']); ?></div>
										<?php else: ?>
											<span class="tt-drag-grip" title="Drag to move">⋮⋮</span>
											<div class="tt-course"><?= esc($cell['course']); ?></div>
											<?php if ($mode === 'class' && !empty($cell['line2'])): ?>
												<div class="tt-sub"><?= esc($cell['line2']); ?></div>
											<?php elseif ($mode === 'teacher'): ?>
												<div class="tt-sub"><?= esc($cell['line2']); ?></div>
												<?php if (!empty($cell['code'])): ?>
													<div class="tt-code"><?= esc($cell['code']); ?></div>
												<?php endif; ?>
											<?php endif; ?>
										<?php endif; ?>
									<?php endif; ?>
								</td>
							<?php endforeach; ?>
						</tr>
					<?php endif;
				endforeach; ?>
				</tbody>
			</table>
		</div>
		<?php if ($editable): ?>
		<div class="tt-staging-dock tt-staging-parking tt-staging-bottom mt-2" id="ttStagingDockBottom" data-drop-zone="parking">
			<div class="tt-staging-label">
				<i class="fa fa-level-down"></i>
				Unscheduled lessons
				<?php if (!empty($staging_remaining)): ?>
					<span class="badge badge-warning ml-1"><?= (int) $staging_remaining; ?> period(s) to place</span>
				<?php endif; ?>
				— drag into a free (green) cell when space is available
			</div>
			<div class="tt-staging-items">
				<?php if (!empty($staging_entries)): ?>
					<?php foreach ($staging_entries as $st): ?>
						<div class="tt-staging-chip tt-lesson-chip"
							draggable="true"
							data-entry-id="<?= (int) $st['id']; ?>"
							data-staff-id="<?= (int) ($st['staff_id'] ?? 0); ?>"
							data-class-id="<?= (int) ($st['class_id'] ?? 0); ?>"
							title="<?= esc($st['course_title'] ?? ''); ?>">
							<strong><?= esc($st['course_title'] ?? 'Lesson'); ?></strong>
							<span><?= esc($mode === 'class' ? ($st['teacher_name'] ?? '') : \App\Libraries\TimetableClassLabel::fromRow($st)); ?></span>
						</div>
					<?php endforeach; ?>
				<?php else: ?>
					<div class="tt-staging-placeholder">All assigned course periods are on the timetable</div>
				<?php endif; ?>
			</div>
		</div>
		<?php endif; ?>
	<?php endif; ?>
</div>
