-- Signal months only, with the first recall on the same model and component
-- filed after the month ended and within signal_followup_days (if any).
select
    model_component_month_key,
    make,
    model,
    component_group,
    month,
    complaints,
    baseline_mean,
    ratio_to_baseline,
    z_score,
    next_recall_date,
    days_to_recall,
    followup_complete
from {{ ref('mart_model_component_monthly') }}
where is_signal
