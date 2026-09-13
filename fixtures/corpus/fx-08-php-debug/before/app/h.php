<?php
function total(array $xs): int {
    $sum = 0;
    foreach ($xs as $x) { $sum += $x; }
    return $sum;
}
