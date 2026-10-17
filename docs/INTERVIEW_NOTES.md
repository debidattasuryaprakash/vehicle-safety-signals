# Be ready to explain

Interviewers will probe this project. Make sure you can answer each question in your own words
and point to the file where the answer lives.

## Resume bullet (draft; put it in your own words)

> Built an end-to-end NHTSA vehicle-safety pipeline (Python ingestion, dbt on DuckDB with a
> Snowflake profile, unit-tested signal logic, GitHub Actions CI, D3 dashboard) over 600k
> complaints, 6k recalls and NHTSA investigations. Backtested the complaint-spike signal with a
> time-split holdout: it barely predicts recalls (1.05×, since 92% are manufacturer-initiated) but
> predicts recalls or NHTSA investigations at 1.18×, with tuned thresholds holding 1.39× out of
> sample.

## Two-minute walkthrough

1. The question: can public complaints flag a defect before a recall?
2. The pipeline: NHTSA files → raw tables → dbt staging, star schema, monthly grid → signal
   mart → backtest → static dashboard, rebuilt and tested on every push.
3. The method: a Poisson z-score against each model and component's own trailing 12 months.
4. The honest result on recalls: a 1.05× lift. At make level it was 0.98×, because busy pairs
   get recalled every year anyway; moving to model level made the outcome measurable.
5. Why: 92.5% of recalls are manufacturer-initiated. Complaints move NHTSA, so I added NHTSA
   investigations as an outcome: 1.18× overall, and the best 2020–22 thresholds held 1.39× on
   2023–25.
6. What it's good for: a triage list. The drill-down shows what owners describe; Tesla's
   "phantom braking" spike matched NHTSA's PE22-002, opened the same month.
7. Next: normalise by vehicles in service, and match components across NHTSA's two taxonomies.

## Questions

| Question | Where the answer lives |
|---|---|
| Why ELT (load raw text, transform in the warehouse) instead of cleaning in Python? | `ingestion/load.py`, `dbt/models/staging` |
| How is the load re-runnable, and what happens if a row arrives twice? | `load.py` (full refresh), `qualify row_number()` in staging |
| What is the grain of `fct_complaints`, and why? One complaint can list several components and vehicles. The `unique` test caught exactly this during the build. | `fct_complaints.sql`, `_marts.yml` |
| Why is `fct_complaints` incremental, and what's the catch? (A logic change needs `--full-refresh`: the blank-component fix only took effect after one.) | `fct_complaints.sql` |
| Why fill months with zero complaints before computing the baseline? | `int_model_component_month_counts.sql` |
| Why does the baseline exclude the current month? | the window frame `12 preceding and 1 preceding` in `mart_model_component_monthly.sql` |
| Why a Poisson z-score instead of the sample standard deviation? What is overdispersion? | same file, README "Limitations" |
| Why measure lead time from the end of the signal month, and why drop spikes that follow a recall? (Otherwise recalls that *caused* complaints count as hits.) | `mart_model_component_monthly.sql`, unit tests in `_intermediate.yml` |
| How do you know the method works? What is lift, and why compare against a base rate? | `mart_signal_backtest.sql`, dashboard "Does the signal rule work?" |
| Why did the make-level rule score 0.98×, and what changed at model level? | README "Findings" |
| Isn't picking z ≥ 5 because it scored best overfitting? (Yes: it's chosen in-sample. You'd need a time split: tune on 2020–2023, test on 2024–2025.) | `mart_signal_backtest.sql` |
| What did the relationship test catch on real data? (Two complaints with a blank component; mapped to "UNKNOWN OR OTHER".) | `stg_complaints.sql` |
| How do the unit tests work, and what broke? (dbt renders the model with placeholder macros while parsing unit tests, so a filter or unary minus on `var()` fails.) | `models/intermediate/_intermediate.yml`, `mart_model_component_monthly.sql` |
| How does the same project run on DuckDB and Snowflake? | `macros/parse_yyyymmdd.sql`, `profiles.yml` |
| What does CI check, and how does the monthly refresh republish? (A `GITHUB_TOKEN` push doesn't trigger workflows; `workflow_dispatch` does.) | `.github/workflows/ci.yml`, `refresh.yml` |
| What is source freshness checking here? | `models/staging/_sources.yml` |
| How did you check the thresholds weren't overfit? (Time split: pick on 2020–22, score on 2023–25. Recall: 1.20× fell to 1.05×. Recall or investigation: 1.26× held at 1.39×.) | `mart_signal_backtest.sql` (`slice`), dashboard "Out-of-sample check" |
| Why match investigations on component when that misses Tesla's PE22-002? (On model alone the base rate is 56%, so every signal "hits" and lift means nothing.) | `mart_model_component_monthly.sql`, `docs/case-studies.md` |
| Why fetch recall details from NHTSA's API in the browser instead of exporting them? (Keeps the static file small, always current; the API allows cross-origin requests.) | `dashboard/app.js` (`showRecall`) |
| Complaint narratives are free text from the public. How do you render them safely? (Everything inserted as HTML is escaped.) | `dashboard/app.js` (`esc`) |
| What would change for normalising by vehicles in service? | README "Limitations" |
