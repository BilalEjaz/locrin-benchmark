<link rel="stylesheet" href="<?= base_url('assets/css/timetable.css'); ?>?v=unplaced-class-1">

<?php
$hasSchedule = !empty($schedule);
$assignCount = (int) ($assignment_count ?? 0);
$testCount = (int) ($test_assignment_count ?? 0);
$stepPeriods = ($period_count ?? 0) > 0;
$stepAssignments = $assignCount > 0;
$stepGenerated = $hasSchedule;
$progressPct = (int) round((($stepPeriods ? 1 : 0) + ($stepAssignments ? 1 : 0) + ($stepGenerated ? 1 : 0)) / 3 * 100);
?>

<div class="tt-dashboard">
	<?php if (!empty($timetable_stale) && (empty($active_generation_job) || !in_array((string) ($active_generation_job['status'] ?? ''), ['queued', 'running'], true))): ?>
	<div class="alert alert-warning mb-3">
		<strong>Timetable out of date.</strong>
		Manage Course assignments (teachers, classes, or credits) changed.
		Click a level below (Nursery, Primary, or High school) to rebuild from Manage Course.
	</div>
	<?php elseif (!empty($active_generation_job) && in_array((string) ($active_generation_job['status'] ?? ''), ['queued', 'running'], true)): ?>
	<div class="alert alert-info mb-3">
		<strong>Generating timetable…</strong>
		Nursery, primary, and secondary stages are running. Progress updates below.
	</div>
	<?php endif; ?>
	<div class="tt-dash-hero mb-4">
		<div class="tt-dash-hero-text">
			<h4 class="mb-1">Smart Timetable Workspace</h4>
			<p class="mb-0 text-muted">
				<?= esc($academic_year_title ?? ''); ?> · Term <?= (int) ($term ?? 1); ?>
				— full-week grids, special blocks, and teacher schedules
			</p>
		</div>
		<div class="tt-dash-hero-actions">
			<a href="<?= esc($settings_url); ?>" class="btn btn-light btn-sm">
				<i class="fa fa-clock-o"></i> Periods &amp; special times
			</a>
		</div>
	</div>

	<div class="row tt-stat-row mb-4">
		<div class="col-6 col-md-3 mb-3 mb-md-0">
			<div class="tt-stat-card">
				<div class="tt-stat-val"><?= (int) ($class_count ?? 0); ?></div>
				<div class="tt-stat-lbl">Classes</div>
			</div>
		</div>
		<div class="col-6 col-md-3 mb-3 mb-md-0">
			<div class="tt-stat-card">
				<div class="tt-stat-val"><?= (int) ($staff_with_timetable ?? 0); ?><span class="tt-stat-of">/<?= (int) ($staff_count ?? 0); ?></span></div>
				<div class="tt-stat-lbl">Staff on timetable</div>
			</div>
		</div>
		<div class="col-6 col-md-3 mb-3 mb-md-0">
			<div class="tt-stat-card">
				<div class="tt-stat-val"><?= $assignCount; ?></div>
				<div class="tt-stat-lbl">Course assignments</div>
			</div>
		</div>
		<div class="col-6 col-md-3">
			<div class="tt-stat-card <?= $hasSchedule ? 'is-ok' : 'is-warn'; ?>">
				<div class="tt-stat-val"><?= $hasSchedule ? (int) ($entry_count ?? 0) : '—'; ?></div>
				<div class="tt-stat-lbl"><?= $hasSchedule ? 'Lesson slots' : 'Not generated'; ?></div>
			</div>
		</div>
	</div>

	<div class="tt-steps card mb-4">
		<div class="card-body py-3">
			<div class="d-flex flex-wrap align-items-center justify-content-between mb-2">
				<strong>Setup progress</strong>
				<span class="badge badge-<?= $progressPct >= 100 ? 'success' : 'primary'; ?>"><?= $progressPct; ?>%</span>
			</div>
			<div class="progress mb-3" style="height:6px;">
				<div class="progress-bar bg-primary" style="width:<?= $progressPct; ?>%;"></div>
			</div>
			<div class="row tt-step-list">
				<div class="col-md-4 tt-step-item <?= $stepPeriods ? 'done' : ''; ?>">
					<span class="tt-step-num">1</span>
					<div>
						<strong>Day structure</strong>
						<div class="small text-muted"><?= (int) ($period_count ?? 0); ?> periods · <?= (int) ($special_count ?? 0); ?> special times</div>
					</div>
				</div>
				<div class="col-md-4 tt-step-item <?= $stepAssignments ? 'done' : ''; ?>">
					<span class="tt-step-num">2</span>
					<div>
						<strong>Course assignments</strong>
						<div class="small text-muted"><?= $assignCount; ?> linked to classes &amp; staff</div>
					</div>
				</div>
				<div class="col-md-4 tt-step-item <?= $stepGenerated ? 'done' : ''; ?>">
					<span class="tt-step-num">3</span>
					<div>
						<strong>Generate &amp; preview</strong>
						<div class="small text-muted"><?= $hasSchedule ? esc($schedule['generated_at'] ?? 'Ready') : 'Waiting'; ?></div>
					</div>
				</div>
			</div>
		</div>
	</div>

	<div class="row mb-4">
		<div class="col-lg-5 mb-3 mb-lg-0">
			<div class="card tt-gen-card tt-gen-card-pro h-100">
				<div class="card-header tt-gen-head">
					<div>
						<strong><i class="fa fa-magic"></i> Generate by level</strong>
						<div class="tt-gen-sub">Nursery · Primary · High school — each builds alone</div>
					</div>
				</div>
				<div class="card-body">
					<?php if (!$stepAssignments): ?>
						<div class="alert alert-warning py-2 small mb-3">
							No course assignments for this term. Assign courses under <strong>Manage Course</strong> first.
						</div>
					<?php endif; ?>

					<div class="tt-level-grid mb-3">
						<?php foreach (($generation_levels ?? []) as $lvl):
							$status = (string) ($lvl['status'] ?? 'pending');
							$disabled = !$stepAssignments || (int) ($lvl['assignments'] ?? 0) <= 0;
							$statusLabel = [
								'generated' => 'Generated',
								'stale' => 'Needs update',
								'pending' => 'Ready',
								'empty' => 'No courses',
							][$status] ?? 'Ready';
							$icon = (string) ($lvl['icon'] ?? 'fa-calendar');
							?>
							<button type="button"
								class="tt-level-tile status-<?= esc($status); ?> btn-generate-level"
								data-phase="<?= esc($lvl['key']); ?>"
								<?= $disabled ? 'disabled' : ''; ?>>
								<span class="tt-level-icon"><i class="fa <?= esc($icon); ?>"></i></span>
								<span class="tt-level-body">
									<span class="tt-level-tile-top">
										<span class="tt-level-name"><?= esc($lvl['label']); ?></span>
										<span class="tt-level-badge"><?= esc($statusLabel); ?></span>
									</span>
									<span class="tt-level-hint"><?= esc($lvl['hint'] ?? ''); ?></span>
									<span class="tt-level-meta">
										<?= (int) ($lvl['classes'] ?? 0); ?> classes · <?= (int) ($lvl['assignments'] ?? 0); ?> courses
										<?php if (!empty($lvl['generated_at']) && $status === 'generated'): ?>
											· <?= esc(date('M j, H:i', strtotime((string) $lvl['generated_at']))); ?>
										<?php endif; ?>
									</span>
								</span>
								<span class="tt-level-cta"><?= $status === 'generated' || $status === 'stale' ? 'Regenerate' : 'Generate'; ?> <i class="fa fa-arrow-right"></i></span>
							</button>
						<?php endforeach; ?>
					</div>

					<div class="tt-gen-options mb-3">
						<label class="tt-ai-toggle mb-0" title="Keep Gemini on to repair teacher/class collisions after generate.">
							<input type="checkbox" id="useAiTips" checked>
							<span>Gemini collision fix</span>
						</label>
						<label class="tt-ai-toggle mb-0" title="Leave unchecked to keep every placed lesson. Check only when you want a full rebuild.">
							<input type="checkbox" id="replaceLockedTimetable">
							<span>Replace locked timetable</span>
						</label>
						<button type="button" class="btn btn-outline-secondary btn-sm" id="btnToggleCriteria">
							Special criteria
						</button>
						<button type="button" class="btn btn-primary btn-sm" id="btnGenerateAll" <?= !$stepAssignments ? 'disabled' : ''; ?>>
							Generate all
						</button>
					</div>
					<p class="small text-muted mb-3">Placed lessons stay locked. Generate only fills empty periods unless you check <strong>Replace locked timetable</strong>.</p>

					<div id="ttCriteriaBox" class="tt-criteria-box mb-3" hidden>
						<div class="small font-weight-bold mb-2">Special scheduling criteria</div>
						<p class="small text-muted mb-2">Document rules apply on high school (combined classes, teacher windows, PE last hour, mornings, clinical). Combined courses share <strong>one teacher period</strong> for every paired class (5 classes × 3 credits = 3 teacher periods, copied to each class). A teacher-days or teacher-window rule is rejected when that teacher already has too many weekly periods to fit (for example Alice Namahoro with 76), except pinned notes such as IZABAYO PATIENCE (fill every Tuesday period before break, then every Friday period after break and before lunch, remainder on Sunday). Every placed lesson is locked after generate, on every level. The next generate only fills empty periods unless you check <strong>Replace locked timetable</strong>. Sunday is reserved: only Teach on Sunday special criteria, or a named Sunday teacher, may use that column. Farming and Library and Clubs stay after 15:40 and never at night. Nursery and primary have no Sunday column.</p>
						<form id="ttCriteriaForm" class="tt-criteria-form">
							<div class="form-row">
								<div class="col-md-4 mb-2">
									<select name="rule_type" id="ttRuleType" class="form-control form-control-sm">
										<option value="last_hour">Put course / teacher at last hour</option>
										<option value="teacher_window">Teacher only on days + time range</option>
										<option value="teacher_days">Teacher only on specific days</option>
										<option value="morning">Prefer morning</option>
										<option value="teach_sunday">Teach this course on Sunday (high school)</option>
										<option value="after_lessons">After 15:40 only (not night)</option>
									</select>
								</div>
								<div class="col-md-4 mb-2">
									<select name="teacher_id" class="form-control form-control-sm">
										<option value="0">Any teacher</option>
										<?php foreach ($staffs as $s): ?>
											<option value="<?= (int) $s['id']; ?>"><?= esc(trim($s['fname'] . ' ' . $s['lname'])); ?></option>
										<?php endforeach; ?>
									</select>
								</div>
								<div class="col-md-4 mb-2">
									<select name="course_id" class="form-control form-control-sm">
										<option value="0">Any course</option>
										<?php foreach (($criteria_courses ?? []) as $c): ?>
											<option value="<?= (int) $c['id']; ?>"><?= esc($c['title']); ?></option>
										<?php endforeach; ?>
									</select>
								</div>
								<div class="col-md-4 mb-2">
									<select name="class_id" class="form-control form-control-sm">
										<option value="0">Any class</option>
										<?php foreach (($classes ?? []) as $c): ?>
											<?php $classLabel = $c['class_label'] ?? (($c['level_name'] ?? '') . ' ' . ($c['title'] ?? '')); ?>
											<option value="<?= (int) $c['id']; ?>"><?= esc(trim($classLabel)); ?></option>
										<?php endforeach; ?>
									</select>
								</div>
							</div>
							<p class="small text-info mb-2" id="ttSundayHint" hidden>Pick the course (and optional teacher/class). Sunday lessons use the same bell periods already saved under Settings → Periods &amp; breaks. Special criteria does not add or change periods.</p>
							<p class="small text-info mb-2" id="ttAfterLessonsHint" hidden>Pick Farming or Library and Clubs. They use existing bells from 15:40 to 17:30 only — not night preps or supper.</p>
							<div class="tt-day-checks mb-2" id="ttCriteriaDays">
								<?php foreach (($criteria_day_choices ?? []) as $dayChoice): ?>
									<label class="small mr-2 mb-0"><input type="checkbox" name="days[]" value="<?= (int) $dayChoice['value']; ?>"> <?= esc($dayChoice['label']); ?></label>
								<?php endforeach; ?>
							</div>
							<div class="form-row" id="ttCriteriaTimes">
								<div class="col-5 mb-2"><input type="time" name="start_time" class="form-control form-control-sm" placeholder="From"></div>
								<div class="col-5 mb-2"><input type="time" name="end_time" class="form-control form-control-sm" placeholder="To"></div>
							</div>
							<div class="form-row">
								<div class="col-12 mb-2"><input type="text" name="note" class="form-control form-control-sm" placeholder="Note (optional)"></div>
							</div>
							<button type="submit" class="btn btn-sm btn-success">Save rule</button>
						</form>
						<ul id="ttCriteriaList" class="tt-criteria-list small mb-0 mt-2">
							<?php
							$ruleTypeLabels = [
								'last_hour' => 'Last hour',
								'teacher_window' => 'Teacher window',
								'teacher_days' => 'Teacher days',
								'morning' => 'Morning',
								'teach_sunday' => 'Teach on Sunday',
								'after_lessons' => 'After 15:40 (not night)',
							];
							foreach (($custom_criteria ?? []) as $rule):
								$days = json_decode((string) ($rule['days'] ?? '[]'), true);
								$dayTxt = is_array($days) && $days !== [] ? implode(',', array_map(static function ($d) {
									return ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][(int) $d] ?? $d;
								}, $days)) : 'any day';
								$typeKey = (string) ($rule['rule_type'] ?? '');
								$typeLabel = $ruleTypeLabels[$typeKey] ?? str_replace('_', ' ', $typeKey);
								?>
								<li data-id="<?= (int) $rule['id']; ?>">
									<strong><?= esc($typeLabel); ?></strong>
									· <?= esc($dayTxt); ?>
									<?php if (!empty($rule['start_time'])): ?> <?= esc($rule['start_time']); ?>–<?= esc($rule['end_time']); ?><?php endif; ?>
									<?php if (!empty($rule['note'])): ?> — <?= esc($rule['note']); ?><?php endif; ?>
									<button type="button" class="btn btn-link btn-sm text-danger p-0 ml-1 tt-del-rule" data-id="<?= (int) $rule['id']; ?>">remove</button>
								</li>
							<?php endforeach; ?>
						</ul>
					</div>

					<div id="generateResult" class="tt-gen-result small"></div>
				</div>
			</div>
		</div>
		<div class="col-lg-7">
			<div class="card h-100">
				<div class="card-header d-flex justify-content-between align-items-center">
					<strong><i class="fa fa-calendar"></i> School day structure</strong>
					<span class="badge badge-secondary"><?= (int) ($period_count ?? 0); ?> teaching periods</span>
				</div>
				<div class="card-body">
					<div class="tt-day-timeline tt-day-timeline-lg">
						<?php foreach ($slots as $slot):
							$isBreak = !empty($slot['is_break']);
							$w = max(8, (int) round((strtotime($slot['end_time']) - strtotime($slot['start_time'])) / 60 / 8));
							?>
							<div class="tt-tl-seg <?= $isBreak ? 'is-break' : 'is-period'; ?>" style="flex:<?= $w; ?>;" title="<?= esc(substr($slot['start_time'], 0, 5) . ' – ' . substr($slot['end_time'], 0, 5)); ?>">
								<span><?= esc($slot['break_label'] ?: $slot['label']); ?></span>
							</div>
						<?php endforeach; ?>
					</div>
					<div class="row mt-3">
						<div class="col-md-6">
							<div class="small text-muted mb-1">Week columns</div>
							<div class="tt-day-pills">
								<?php foreach ($day_labels ?? ['Mon','Tue','Wed','Thu','Fri'] as $dl): ?>
									<span class="tt-day-pill"><?= esc($dl); ?></span>
								<?php endforeach; ?>
							</div>
						</div>
						<div class="col-md-6">
							<?php if (!empty($special_times)): ?>
								<div class="small text-muted mb-1">Special times</div>
								<?php foreach ($special_times as $st): ?>
									<span class="tt-legend-chip tt-special-<?= esc($st['color'] ?? 'yellow'); ?> mr-1 mb-1">
										<?= esc(['Mon','Tue','Wed','Thu','Fri','','Sun'][(int) $st['day_of_week']] ?? '?'); ?>
										<?= esc($st['slot_label'] ?? ''); ?> — <?= esc($st['label']); ?>
									</span>
								<?php endforeach; ?>
							<?php else: ?>
								<div class="small text-muted">No special times yet — add Chapel, Sabbath, etc. in settings.</div>
							<?php endif; ?>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>

	<?php if ($hasSchedule): ?>
	<div class="card mb-4 tt-export-card">
		<div class="card-header"><strong><i class="fa fa-file-pdf-o"></i> Export all timetables (PDF)</strong></div>
		<div class="card-body">
			<div class="d-flex flex-wrap align-items-center mb-2" style="gap:10px;">
				<a href="<?= site_url('timetable/pdf_all_classes'); ?>" class="btn btn-primary" target="_blank">
					<i class="fa fa-download"></i> All class timetables (<?= (int) ($class_count ?? 0); ?>)
				</a>
				<a href="<?= site_url('timetable/pdf_all_teachers'); ?>" class="btn btn-info" target="_blank">
					<i class="fa fa-download"></i> All teacher / staff timetables (<?= (int) ($staff_count ?? 0); ?>)
				</a>
				<a href="<?= site_url('timetable/pdf_unplaced'); ?>" class="btn btn-warning" target="_blank">
					<i class="fa fa-file-pdf-o"></i> Unplaced periods summary
				</a>
			</div>
			<div class="small font-weight-bold mb-1">Class PDFs by level</div>
			<div class="d-flex flex-wrap align-items-center" style="gap:10px;">
				<?php foreach (($generation_levels ?? []) as $lvl):
					$lvlKey = (string) ($lvl['key'] ?? '');
					$lvlCount = (int) ($lvl['classes'] ?? 0);
					$lvlHref = site_url('timetable/pdf_all_classes/' . rawurlencode($lvlKey));
					?>
					<?php if ($lvlCount > 0): ?>
						<a href="<?= esc($lvlHref); ?>" class="btn btn-outline-primary" target="_blank">
							<i class="fa <?= esc($lvl['icon'] ?? 'fa-download'); ?>"></i>
							<?= esc($lvl['label'] ?? $lvlKey); ?>
							(<?= $lvlCount; ?>)
						</a>
					<?php else: ?>
						<button type="button" class="btn btn-outline-secondary" disabled>
							<?= esc($lvl['label'] ?? $lvlKey); ?> (0)
						</button>
					<?php endif; ?>
				<?php endforeach; ?>
				<span class="text-muted small">Nursery, Primary, or High school (all remaining classes). One landscape A4 PDF each.</span>
			</div>
		</div>
	</div>
	<?php endif; ?>

	<div class="tt-preview-card">
		<div class="tt-preview-head">
			<div>
				<strong><i class="fa fa-table"></i> Weekly timetable preview</strong>
				<span class="text-muted small ml-1">All days visible</span>
			</div>
			<div class="d-flex flex-wrap align-items-center tt-preview-controls">
				<?php
					$previewMode = (($preview_mode ?? 'class') === 'teacher') ? 'teacher' : 'class';
					$previewClassId = (int) ($preview_class_id ?? 0);
					$previewTeacherId = (int) ($preview_teacher_id ?? 0);
				?>
				<select id="previewMode" class="form-control form-control-sm">
					<option value="class" <?= $previewMode === 'class' ? 'selected' : ''; ?>>Class</option>
					<option value="teacher" <?= $previewMode === 'teacher' ? 'selected' : ''; ?>>Teacher</option>
				</select>
				<div class="tt-live-pick tt-preview-entity<?= $previewMode === 'teacher' ? ' d-none' : ''; ?>" data-tt-live-pick id="previewClassPick">
					<input type="search" class="form-control form-control-sm tt-live-pick-q" placeholder="Search class…" autocomplete="off">
					<select id="previewClass" class="tt-live-pick-select" aria-hidden="true" tabindex="-1">
						<?php foreach ($classes as $c): ?>
							<?php $classLabel = $c['class_label'] ?? (($c['level_name'] ?? '') . ' ' . $c['title']); ?>
							<option value="<?= (int) $c['id']; ?>" data-search="<?= esc($classLabel); ?>" <?= (int) $c['id'] === $previewClassId ? 'selected' : ''; ?>><?= esc($classLabel); ?></option>
						<?php endforeach; ?>
					</select>
					<div class="tt-live-pick-menu" hidden></div>
				</div>
				<div class="tt-live-pick tt-preview-entity<?= $previewMode === 'teacher' ? '' : ' d-none'; ?>" data-tt-live-pick id="previewTeacherPick">
					<input type="search" class="form-control form-control-sm tt-live-pick-q" placeholder="Search teacher…" autocomplete="off">
					<select id="previewTeacher" class="tt-live-pick-select" aria-hidden="true" tabindex="-1">
						<?php foreach ($staffs as $s): ?>
							<?php
								$teacherLabel = trim(($s['fname'] ?? '') . ' ' . ($s['lname'] ?? ''));
								if (!empty($s['post_title'])) {
									$teacherLabel .= ' · ' . $s['post_title'];
								}
								$teacherSearch = trim(($s['fname'] ?? '') . ' ' . ($s['lname'] ?? '') . ' ' . ($s['post_title'] ?? ''));
							?>
							<option value="<?= (int) $s['id']; ?>" data-search="<?= esc($teacherSearch); ?>" <?= (int) $s['id'] === $previewTeacherId ? 'selected' : ''; ?>><?= esc($teacherLabel); ?></option>
						<?php endforeach; ?>
					</select>
					<div class="tt-live-pick-menu" hidden></div>
				</div>
				<a href="#" id="previewOpenFull" class="btn btn-sm btn-info">Full page</a>
				<a href="#" id="previewPrint" class="btn btn-sm btn-outline-secondary">Print PDF</a>
			</div>
		</div>
		<div class="tt-preview-body" id="ttPreviewBody">
			<?php if (!empty($preview_data)): ?>
				<?= view('pages/timetable/_grid_body', $preview_data); ?>
			<?php elseif ($hasSchedule): ?>
				<div class="tt-empty-grid p-4 text-center text-muted">Select a class or teacher above to preview.</div>
			<?php else: ?>
				<div class="tt-empty-state">
					<div class="tt-empty-icon"><i class="fa fa-calendar-o"></i></div>
					<h5>No timetable generated yet</h5>
					<p class="text-muted mb-3">Assign courses to classes, then click <strong>Generate smart timetable</strong> to fill this full-week grid.</p>
					<div class="tt-skeleton-grid">
						<div class="tt-skel-head">
							<?php foreach ($day_labels ?? ['Mon','Tue','Wed','Thu','Fri'] as $dl): ?>
								<span><?= esc($dl); ?></span>
							<?php endforeach; ?>
						</div>
						<?php for ($r = 0; $r < 5; $r++): ?>
							<div class="tt-skel-row"><span></span><span></span><span></span><span></span><span></span></div>
						<?php endfor; ?>
					</div>
				</div>
			<?php endif; ?>
		</div>
	</div>
</div>

<script src="<?= base_url('assets/js/timetable-live-edit.js'); ?>"></script>
<script src="<?= base_url('assets/js/timetable-live-pick.js'); ?>"></script>
<?php
$ttJsonFlags = JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT;
if (defined('JSON_INVALID_UTF8_SUBSTITUTE')) {
	$ttJsonFlags |= JSON_INVALID_UTF8_SUBSTITUTE;
}
$ttEncodeJob = static function ($job) use ($ttJsonFlags): string {
	if (!is_array($job)) {
		return 'null';
	}
	if (isset($job['collision_report']['items']) && is_array($job['collision_report']['items'])) {
		$job['collision_report']['items'] = array_values(array_slice($job['collision_report']['items'], 0, 25));
	}
	$json = json_encode($job, $ttJsonFlags);
	return $json === false ? 'null' : $json;
};
?>
<script>
(function () {
	var classBase = '<?= site_url('timetable/class'); ?>';
	var teacherBase = '<?= site_url('timetable/teacher'); ?>';
	var printClassBase = '<?= site_url('timetable/print_class'); ?>';
	var printTeacherBase = '<?= site_url('timetable/print_teacher'); ?>';
	var jobStatusBase = '<?= site_url('timetable/generate_status'); ?>';
	var discardJobUrl = '<?= site_url('timetable/discard_generation'); ?>';
	var hasSchedule = <?= $hasSchedule ? 'true' : 'false'; ?>;
	var activeJob = <?= $ttEncodeJob($active_generation_job ?? null); ?>;
	var lastJob = <?= $ttEncodeJob($last_generation_job ?? null); ?>;
	var pollTimer = null;
	var pollFails = 0;
	var saveCriteriaUrl = '<?= site_url('timetable/save_criteria'); ?>';
	var deleteCriteriaUrl = '<?= site_url('timetable/delete_criteria'); ?>';
	var unplacedPdfBase = '<?= site_url('timetable/pdf_unplaced'); ?>';
	var dashboardUrl = '<?= site_url('timetable/dashboard'); ?>';
	var hasServerPreview = <?= !empty($preview_data) ? 'true' : 'false'; ?>;
	var initialPreviewMode = '<?= (($preview_mode ?? 'class') === 'teacher') ? 'teacher' : 'class'; ?>';
	var initialPreviewClassId = '<?= (int) ($preview_class_id ?? 0); ?>';
	var initialPreviewTeacherId = '<?= (int) ($preview_teacher_id ?? 0); ?>';

	function esc(s) {
		return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
			return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);
		});
	}

	function groupByClass(items, classKey) {
		var groups = {};
		var order = [];
		(items || []).forEach(function (item) {
			var name = String((item && (item[classKey] || item.class)) || '').trim() || 'Class not identified';
			if (!groups[name]) {
				groups[name] = [];
				order.push(name);
			}
			groups[name].push(item);
		});
		order.sort(function (a, b) { return a.localeCompare(b); });
		return order.map(function (name) { return { class: name, items: groups[name] }; });
	}

	function renderClassGroups(groups, renderItems) {
		var html = '<div class="tt-scroll-box">';
		(groups || []).forEach(function (group) {
			var count = (group.items || []).length;
			html += '<div class="tt-class-group">'
				+ '<div class="tt-class-group-title">' + esc(group.class || 'Class')
				+ ' <span class="tt-class-group-count">' + count + ' lesson' + (count === 1 ? '' : 's')
				+ (group.missed ? ' · ' + group.missed + ' parked' : '')
				+ '</span></div>'
				+ renderItems(group.items || [])
				+ '</div>';
		});
		html += '</div>';
		return html;
	}

	function renderCollisionReport(report, hasUnplaced) {
		if (!report) return '';
		var html = '';
		var total = parseInt(report.total, 10) || 0;
		var alerts = report.assignment_alerts || [];
		if (total <= 0) {
			html += '<div class="alert alert-success py-2 mb-2"><strong>Grid is collision-free.</strong> '
				+ 'No teacher is in two classes at once, and no two teachers share a class period. '
				+ 'Anything that would collide was parked instead of placed.</div>';
		} else {
			html += '<div class="alert alert-danger py-2 mb-2"><strong>' + total + ' collision' + (total === 1 ? '' : 's')
				+ ' still on the grid.</strong> Generate again — extras are parked so slots stay legal.</div>';
			html += renderClassGroups(groupByClass(report.items || [], 'class'), function (items) {
				var inner = '<ol class="tt-collision-list mb-0 pl-3">';
				items.forEach(function (item) {
					inner += '<li><div>' + esc(item.message || '') + '</div>'
						+ (item.fix ? '<div class="text-muted">Correct in Manage Course: ' + esc(item.fix) + '</div>' : '')
						+ '</li>';
				});
				return inner + '</ol>';
			});
		}
		if (alerts.length) {
			html += '<div class="alert alert-warning py-2 mb-2"><strong>Correct course assignment</strong> — '
				+ alerts.length + ' teacher/class load' + (alerts.length === 1 ? '' : 's')
				+ ' cannot fit the week without a collision.</div>';
			html += '<div class="tt-scroll-box">';
			alerts.forEach(function (alert) {
				html += '<div class="tt-class-group">';
				html += '<div class="tt-class-group-title">' + esc(alert.teacher || alert.class || 'Assignment')
					+ ' <span class="tt-class-group-count">' + (alert.assigned || 0) + ' assigned / '
					+ (alert.available || 0) + ' slots</span></div>';
				html += '<div class="small mb-1">' + esc(alert.message || '') + '</div>';
				if (alert.items && alert.items.length) {
					html += '<ul class="pl-3 mb-0 small">';
					alert.items.slice(0, 12).forEach(function (item) {
						html += '<li>' + esc(item.class || item.teacher || '')
							+ ' — ' + esc(item.course || '')
							+ ' (' + (item.hours || 0) + ' periods)</li>';
					});
					html += '</ul>';
				}
				html += '</div>';
			});
			html += '</div>';
		}
		if (!hasUnplaced && report.warnings && report.warnings.length) {
			html += '<div class="small font-weight-bold text-warning mb-1">Parked instead of colliding</div>';
			html += '<div class="tt-scroll-box"><ul class="pl-3 mb-0">';
			report.warnings.forEach(function (w) { html += '<li>' + esc(w) + '</li>'; });
			html += '</ul></div>';
		}
		return html;
	}

	function renderUnplacedReport(report, jobId, pdfName) {
		if (!report) return '';
		var missed = parseInt(report.missed_periods, 10) || 0;
		var html = '';
		if (missed <= 0) {
			html += '<div class="alert alert-success py-2 mb-2">Every Manage Course period was placed. Nothing is waiting in the parking lot.</div>';
		} else {
			html += '<div class="alert alert-warning py-2 mb-2"><strong>' + missed + ' period' + (missed === 1 ? '' : 's')
				+ ' could not be placed without a collision.</strong> '
				+ (function () {
					var classCount = parseInt(report.missed_classes, 10);
					if (!classCount) classCount = groupByClass(report.courses || [], 'class').length;
					return classCount + ' class' + (classCount === 1 ? '' : 'es') + ', ';
				})()
				+ (report.missed_courses || 0) + ' course' + ((report.missed_courses || 0) === 1 ? '' : 's') + ', '
				+ (report.missed_teachers || 0) + ' teacher' + ((report.missed_teachers || 0) === 1 ? '' : 's')
				+ '. Grouped by class below — they stay parked.</div>';
			var groups = report.by_class && report.by_class.length
				? report.by_class
				: groupByClass(report.courses || [], 'class');
			html += renderClassGroups(groups, function (items) {
				var inner = '<ul class="pl-3 mb-0 small">';
				items.forEach(function (row) {
					inner += '<li><strong>' + esc(row.course || 'Lesson') + '</strong>'
						+ (row.code ? ' (' + esc(row.code) + ')' : '')
						+ ' with ' + esc(row.teacher || 'Unassigned')
						+ ' — ' + (row.placed || 0) + '/' + (row.needed || 0) + ' placed'
						+ ', <strong>' + (row.missed || 0) + ' parked</strong>';
					if (row.window) inner += '<div class="text-muted">' + esc(row.window) + '</div>';
					if (row.reason) inner += '<div>' + esc(row.reason) + '</div>';
					inner += (row.suggestions && row.suggestions.length
						? '<div class="text-muted">Free slots: ' + esc(row.suggestions.join('; ')) + '</div>'
						: '<div class="text-muted">No legal empty slot.</div>');
					inner += '</li>';
				});
				return inner + '</ul>';
			});
		}
		var href = unplacedPdfBase + (jobId ? '/' + encodeURIComponent(jobId) : '');
		html += '<a class="btn btn-sm btn-warning mb-2" href="' + href + '" target="_blank">'
			+ '<i class="fa fa-file-pdf-o"></i> Download unplaced-periods PDF'
			+ (pdfName ? '' : '') + '</a>';
		return html;
	}

	function currentMode() { return $('#previewMode').val(); }
	function currentId() {
		return currentMode() === 'teacher' ? $('#previewTeacher').val() : $('#previewClass').val();
	}

	function syncEntityOptions() {
		var teacher = currentMode() === 'teacher';
		$('#previewClassPick').toggleClass('d-none', teacher);
		$('#previewTeacherPick').toggleClass('d-none', !teacher);
	}

	function loadPreview(force) {
		if (!hasSchedule) return;
		var mode = currentMode();
		var id = currentId();
		if (!id) return;
		var sameAsServer = mode === initialPreviewMode && (
			(mode === 'class' && String(id) === String(initialPreviewClassId))
			|| (mode === 'teacher' && String(id) === String(initialPreviewTeacherId))
		);
		if (!force && hasServerPreview && sameAsServer && $('#ttPreviewBody .tt-sheet').length) {
			return;
		}
		window.location = dashboardUrl + '?preview_mode=' + encodeURIComponent(mode) + '&preview_id=' + encodeURIComponent(id);
	}

	function stopJobPolling() {
		if (pollTimer) {
			clearTimeout(pollTimer);
			pollTimer = null;
		}
	}

	function setGenerating(busy) {
		$('.btn-generate-level, #btnGenerateAll').prop('disabled', !!busy);
		if (!busy) {
			$('.btn-generate-level').each(function () {
				if ($(this).hasClass('status-empty')) $(this).prop('disabled', true);
			});
		}
	}

	function renderJobState(job) {
		if (!job) return;
		var status = job.status || '';
		var pct = Math.max(0, Math.min(100, parseInt(job.progress, 10) || 0));
		var html = '';
		if (status === 'queued' || status === 'running') {
			setGenerating(true);
			if (status === 'queued' && pct < 1) pct = 1;
			html = '<div class="tt-gen-progress">'
				+ '<div class="d-flex justify-content-between align-items-center mb-1">'
				+ '<span><i class="fa fa-spinner fa-spin text-primary"></i> '
				+ (job.message || 'Generating…') + '</span>'
				+ '<strong>' + pct + '%</strong></div>'
				+ '<div class="progress mb-2" style="height:10px;">'
				+ '<div class="progress-bar progress-bar-striped progress-bar-animated bg-primary" role="progressbar" '
				+ 'style="width:' + pct + '%;"></div></div>';
			if (job.stages && job.stages.length) {
				html += '<ul class="list-unstyled mb-0 small tt-gen-stages">';
				job.stages.forEach(function (s) {
					var icon = 'fa-circle-o text-muted';
					var cls = 'text-muted';
					if (s.status === 'running') { icon = 'fa-spinner fa-spin text-primary'; cls = 'text-primary font-weight-bold'; }
					else if (s.status === 'done') { icon = 'fa-check-circle text-success'; cls = 'text-success'; }
					html += '<li class="' + cls + '"><i class="fa ' + icon + '"></i> ' + (s.label || s.key) + '</li>';
				});
				html += '</ul>';
			}
			html += '<div class="mt-2">'
				+ '<button type="button" class="btn btn-sm btn-outline-danger mr-2" id="btnDiscardGeneration">Discard</button>'
				+ '<button type="button" class="btn btn-sm btn-primary" id="btnDiscardAndRegen">Discard and regenerate</button>'
				+ '</div>';
			html += '</div>';
		} else if (status === 'done') {
			setGenerating(false);
			html = '<div class="progress mb-2" style="height:8px;"><div class="progress-bar bg-success" style="width:100%;"></div></div>'
				+ '<div class="alert alert-success py-2 mb-2">' + esc(job.message || 'Timetable generated.') + '</div>';
			var hasUnplaced = !!(job.unplaced_report && ((job.unplaced_report.courses && job.unplaced_report.courses.length) || (parseInt(job.unplaced_report.missed_periods, 10) || 0) > 0));
			html += renderCollisionReport(job.collision_report, hasUnplaced);
			html += renderUnplacedReport(job.unplaced_report, job.id || job.job_id, job.unplaced_pdf);
			if (job.ai_tip) html += '<div class="alert alert-info mt-2 py-2 small mb-2"><strong>AI:</strong> ' + esc(job.ai_tip).replace(/\n/g, '<br>') + '</div>';
			html += '<button type="button" class="btn btn-sm btn-outline-primary" id="btnRefreshPreview">Refresh preview</button>';
		} else if (status === 'failed' || status === 'cancelled') {
			setGenerating(false);
			var tone = status === 'cancelled' ? 'warning' : 'danger';
			html = '<div class="alert alert-' + tone + ' py-2 mb-2">' + (job.message || (status === 'cancelled' ? 'Generation discarded.' : 'Generation failed.')) + '</div>'
				+ '<button type="button" class="btn btn-sm btn-primary" id="btnRetryGenerate">Generate again</button>';
		}
		if (html) $('#generateResult').html(html);
	}

	function pollJob(jobId) {
		if (!jobId) return;
		stopJobPolling();
		$.ajax({
			url: jobStatusBase + '/' + encodeURIComponent(jobId),
			dataType: 'json',
			timeout: 20000
		}).done(function (job) {
			pollFails = 0;
			activeJob = job || null;
			renderJobState(activeJob);
			if (job && (job.status === 'queued' || job.status === 'running')) {
				pollTimer = setTimeout(function () { pollJob(jobId); }, 2000);
				return;
			}
			if (job && job.status === 'cancelled') {
				setGenerating(false);
			}
			if (job && job.status === 'done') {
				window.location = dashboardUrl;
			}
		}).fail(function (xhr) {
			pollFails += 1;
			if (pollFails < 8) {
				pollTimer = setTimeout(function () { pollJob(jobId); }, 2500);
				return;
			}
			setGenerating(false);
			var extra = (xhr && xhr.status) ? ' (HTTP ' + xhr.status + ')' : '';
			$('#generateResult').html('<div class="alert alert-danger py-2 mb-0">Could not read timetable job status' + extra + '. Refresh and try again.</div>');
		});
	}

	function startGenerate(phase, force) {
		if ($('#replaceLockedTimetable').is(':checked') && !window.confirm('Replace locked timetable will rebuild this level and can move every lesson. Continue?')) {
			return;
		}
		setGenerating(true);
		var label = phase === 'nursery' ? 'Nursery' : (phase === 'primary' ? 'Primary' : (phase === 'high_school' || phase === 'secondary' ? 'High school' : 'All levels'));
		$('#generateResult').html(
			'<div class="tt-gen-progress">'
			+ '<div class="d-flex justify-content-between align-items-center mb-1">'
			+ '<span><i class="fa fa-spinner fa-spin text-primary"></i> Queuing ' + label + '…</span>'
			+ '<strong>3%</strong></div>'
			+ '<div class="progress mb-0" style="height:10px;">'
			+ '<div class="progress-bar progress-bar-striped progress-bar-animated bg-primary" style="width:3%;"></div></div></div>'
		);
		$.ajax({
			url: '<?= site_url('timetable/generate'); ?>',
			method: 'POST',
			dataType: 'json',
			timeout: 30000,
			data: {
				academic_year: <?= (int) ($academic_year ?? 0); ?>,
				term: <?= (int) ($term ?? 1); ?>,
				use_gemini: $('#useAiTips').is(':checked') ? 1 : 0,
				replace_locked: $('#replaceLockedTimetable').is(':checked') ? 1 : 0,
				phase: phase || 'all',
				force: force ? 1 : 0
			}
		}).done(function (r) {
			if (r && r.error) {
				setGenerating(false);
				$('#generateResult').html('<div class="alert alert-danger py-2 mb-0">' + r.error + '</div>');
				return;
			}
			activeJob = r || null;
			if (activeJob && !activeJob.status) activeJob.status = 'queued';
			if (activeJob && !activeJob.progress) activeJob.progress = 3;
			if (activeJob && !activeJob.message) activeJob.message = 'Generating ' + label + '…';
			renderJobState(activeJob);
			if (r && r.job_id) {
				pollJob(r.job_id);
			} else {
				setGenerating(false);
				$('#generateResult').html('<div class="alert alert-danger py-2 mb-0">No generation job was created.</div>');
			}
		}).fail(function (xhr) {
			setGenerating(false);
			var msg = 'Generation failed — check course assignments.';
			if (xhr && xhr.responseJSON && xhr.responseJSON.error) {
				msg = xhr.responseJSON.error;
			} else if (xhr && xhr.statusText === 'timeout') {
				msg = 'Server took too long to queue the job. Refresh and try again.';
			} else if (xhr && xhr.status) {
				msg = 'Generation failed (HTTP ' + xhr.status + '). Please try again.';
			}
			$('#generateResult').html('<div class="alert alert-danger py-2 mb-0">' + msg + '</div>');
		});
	}

	$('#previewMode').on('change', function () { syncEntityOptions(); loadPreview(); });
	$('#previewClass, #previewTeacher').on('change', loadPreview);

	$('#previewOpenFull').on('click', function (e) {
		e.preventDefault();
		if (!hasSchedule) return;
		window.location = (currentMode() === 'class' ? classBase : teacherBase) + '/' + currentId();
	});
	$('#previewPrint').on('click', function (e) {
		e.preventDefault();
		if (!hasSchedule) return;
		var mode = currentMode(), id = currentId();
		var url = (mode === 'class' ? printClassBase : printTeacherBase) + '/' + id;
		window.location = url;
	});

	$(document).on('click', '.btn-generate-level', function () {
		startGenerate($(this).data('phase') || 'all');
	});
	$('#btnGenerateAll').on('click', function () {
		startGenerate('all');
	});
	function discardGeneration(thenRegen) {
		stopJobPolling();
		$.ajax({
			url: discardJobUrl,
			method: 'POST',
			dataType: 'json',
			timeout: 20000,
			data: {
				academic_year: <?= (int) ($academic_year ?? 0); ?>,
				term: <?= (int) ($term ?? 1); ?>
			}
		}).done(function (r) {
			setGenerating(false);
			activeJob = null;
			if (thenRegen) {
				startGenerate('all', true);
				return;
			}
			$('#generateResult').html('<div class="alert alert-warning py-2 mb-0">'
				+ esc((r && r.message) || 'Generation discarded. You can generate again.') + '</div>');
		}).fail(function () {
			setGenerating(false);
			$('#generateResult').html('<div class="alert alert-danger py-2 mb-0">Could not discard the generation. Refresh and try again.</div>');
		});
	}
	$(document).on('click', '#btnDiscardGeneration', function () {
		discardGeneration(false);
	});
	$(document).on('click', '#btnDiscardAndRegen', function () {
		discardGeneration(true);
	});
	$(document).on('click', '#btnRetryGenerate', function () {
		startGenerate('all', true);
	});
	$('#btnToggleCriteria').on('click', function () {
		var box = document.getElementById('ttCriteriaBox');
		if (box) box.hidden = !box.hidden;
	});
	function syncSundayRuleUi() {
		var sunday = $('#ttRuleType').val() === 'teach_sunday';
		var afterLessons = $('#ttRuleType').val() === 'after_lessons';
		var hideTimes = sunday || afterLessons;
		$('#ttSundayHint').prop('hidden', !sunday);
		$('#ttAfterLessonsHint').prop('hidden', !afterLessons);
		$('#ttCriteriaDays, #ttCriteriaTimes').toggle(!hideTimes);
		if (sunday) {
			$('.tt-day-checks input').prop('checked', false);
			$('.tt-day-checks input[value="6"]').prop('checked', true);
			$('#ttCriteriaTimes input').val('');
		}
		if (afterLessons) {
			$('.tt-day-checks input').prop('checked', false);
			$('#ttCriteriaTimes input').val('');
		}
	}
	$('#ttRuleType').on('change', syncSundayRuleUi);
	syncSundayRuleUi();
	$('#ttCriteriaForm').on('submit', function (e) {
		e.preventDefault();
		$.ajax({
			url: saveCriteriaUrl,
			method: 'POST',
			dataType: 'json',
			data: $(this).serialize()
		}).done(function (r) {
			if (r && r.error) { alert(r.error); return; }
			alert('Rule saved. Generate again to apply it.');
			location.reload();
		}).fail(function () { alert('Could not save rule.'); });
	});
	$(document).on('click', '.tt-del-rule', function () {
		var id = $(this).data('id');
		$.post(deleteCriteriaUrl, { id: id }, function (r) {
			if (r && r.success) location.reload();
		}, 'json');
	});
	$(document).on('click', '#btnRefreshPreview', function () {
		window.location = dashboardUrl;
	});

	if (window.TtLivePick) {
		TtLivePick.init('#previewClassPick, #previewTeacherPick');
	}
	syncEntityOptions();
	if (activeJob && activeJob.id && (activeJob.status === 'queued' || activeJob.status === 'running')) {
		renderJobState(activeJob);
		pollJob(activeJob.id);
	} else if (lastJob && (lastJob.collision_report || lastJob.unplaced_report)) {
		if (!lastJob.status) lastJob.status = 'done';
		renderJobState(lastJob);
	}
})();
</script>
