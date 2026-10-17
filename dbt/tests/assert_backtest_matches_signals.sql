-- The backtest row for the current thresholds must count exactly the signals
-- in mart_signals that have a full follow-up window, and the same hits.
with expected as (
    select
        count(*) as signals,
        sum(case when next_recall_date is not null then 1 else 0 end) as hits
    from {{ ref('mart_signals') }}
    where followup_complete
),

actual as (
    select signals, hits from {{ ref('mart_signal_backtest') }}
    where is_current and outcome = 'recall' and slice = 'all'
)

select *
from expected e
cross join actual a
where e.signals <> a.signals or coalesce(e.hits, 0) <> coalesce(a.hits, 0)
