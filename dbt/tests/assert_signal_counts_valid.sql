-- A signal must have at least the minimum complaints and exceed its baseline.
select *
from {{ ref('mart_signals') }}
where complaints < {{ var('signal_min_complaints') }}
   or complaints <= baseline_mean
