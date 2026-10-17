-- One backtest row per threshold pair.
select min_z, ratio
from {{ ref('mart_signal_backtest') }}
group by 1, 2
having count(*) > 1
