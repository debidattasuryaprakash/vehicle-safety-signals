-- One backtest row per threshold pair, outcome and slice.
select min_z, ratio, outcome, slice
from {{ ref('mart_signal_backtest') }}
group by 1, 2, 3, 4
having count(*) > 1
