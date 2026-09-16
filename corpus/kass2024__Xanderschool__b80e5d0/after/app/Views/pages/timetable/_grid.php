<link rel="stylesheet" href="<?= base_url('assets/css/timetable.css'); ?>?v=nursery-colors-1">

<div class="tt-page">
	<div class="d-flex flex-wrap justify-content-between align-items-center mb-3">
		<div class="tt-live-pick" data-tt-live-pick style="max-width:360px;">
			<input type="search" class="form-control form-control-sm tt-live-pick-q" placeholder="<?= $mode === 'class' ? 'Search class…' : 'Search teacher…'; ?>" autocomplete="off">
			<select id="ttEntitySwitch" class="tt-live-pick-select" aria-hidden="true" tabindex="-1">
				<?php if ($mode === 'class'): ?>
					<?php foreach ($classes as $c): ?>
						<?php $classLabel = $c['class_label'] ?? (($c['level_name'] ?? '') . ' ' . $c['title']); ?>
						<option value="<?= (int) $c['id']; ?>" data-search="<?= esc($classLabel); ?>" <?= (int) $entity_id === (int) $c['id'] ? 'selected' : ''; ?>>
							<?= esc($classLabel); ?>
						</option>
					<?php endforeach; ?>
				<?php else: ?>
					<?php foreach ($staffs as $s): ?>
						<?php
							$teacherLabel = trim(($s['fname'] ?? '') . ' ' . ($s['lname'] ?? ''));
							$teacherSearch = trim($teacherLabel . ' ' . ($s['post_title'] ?? ''));
						?>
						<option value="<?= (int) $s['id']; ?>" data-search="<?= esc($teacherSearch); ?>" <?= (int) $entity_id === (int) $s['id'] ? 'selected' : ''; ?>>
							<?= esc($teacherLabel); ?>
						</option>
					<?php endforeach; ?>
				<?php endif; ?>
			</select>
			<div class="tt-live-pick-menu" hidden></div>
		</div>
		<div>
			<a href="<?= site_url('timetable/dashboard'); ?>" class="btn btn-sm btn-outline-secondary">Back</a>
			<a href="<?= site_url($mode === 'class' ? 'timetable/print_class/' . $entity_id : 'timetable/print_teacher/' . $entity_id); ?>" target="_blank" class="btn btn-sm btn-primary">Print / PDF</a>
		</div>
	</div>

	<?= view('pages/timetable/_grid_body', get_defined_vars()); ?>
</div>

<script src="<?= base_url('assets/js/timetable-live-edit.js'); ?>"></script>
<script src="<?= base_url('assets/js/timetable-live-pick.js'); ?>"></script>
<script>
if (window.TtLivePick) TtLivePick.init('[data-tt-live-pick]');
$('#ttEntitySwitch').on('change', function () {
	var id = $(this).val();
	var base = '<?= site_url($mode === 'class' ? 'timetable/class' : 'timetable/teacher'); ?>';
	window.location = base + '/' + id;
});
</script>
