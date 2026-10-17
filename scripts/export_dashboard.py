"""Export the dbt marts to dashboard/data/dashboard.json for the static dashboard.

Usage:
  TARGET=duckdb    python scripts/export_dashboard.py
  TARGET=snowflake python scripts/export_dashboard.py
Set DATA_LABEL="NHTSA" once you've loaded the real files (default: SAMPLE).
"""
import json
import os
import sys
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ingestion"))
from config import DUCKDB_PATH, TARGET  # noqa: E402

OUT = ROOT / "dashboard" / "data" / "dashboard.json"


def connect():
    if TARGET == "snowflake":
        import snowflake.connector
        con = snowflake.connector.connect(
            account=os.environ["SNOWFLAKE_ACCOUNT"], user=os.environ["SNOWFLAKE_USER"],
            password=os.environ["SNOWFLAKE_PASSWORD"], role=os.getenv("SNOWFLAKE_ROLE"),
            warehouse=os.environ["SNOWFLAKE_WAREHOUSE"], database=os.environ["SNOWFLAKE_DATABASE"],
        )
        cur = con.cursor()
        def query(sql):
            cur.execute(sql)
            cols = [c[0].lower() for c in cur.description]
            return [dict(zip(cols, r)) for r in cur.fetchall()]
        return query
    import duckdb
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    def query(sql):
        res = con.execute(sql)
        cols = [c[0].lower() for c in res.description]
        return [dict(zip(cols, r)) for r in res.fetchall()]
    return query


def clean(v):
    if isinstance(v, (date, datetime)):
        return v.isoformat()[:10]
    if isinstance(v, Decimal):
        return float(v)
    return v


def rows(query, sql):
    return [{k: clean(v) for k, v in r.items()} for r in query(sql)]


def main():
    q = connect()
    monthly = rows(q, """
        select make, received_month as month, count(*) as complaints,
               sum(case when is_crash then 1 else 0 end) as crashes
        from marts.fct_complaints
        where received_month <= (select max(month) from marts.mart_model_component_monthly)
        group by 1, 2 order by 2, 1""")
    components = rows(q, """
        with mx as (select max(month) as m from marts.mart_model_component_monthly)
        select make, component_group, count(*) as complaints
        from marts.fct_complaints, mx
        where received_month <= mx.m and received_month > """ + ("dateadd(month, -12, mx.m)" if TARGET == "snowflake"
                                       else "mx.m - interval 12 month") + """
        group by 1, 2""")
    signals = rows(q, """
        select make, model, component_group, month, complaints, baseline_mean,
               ratio_to_baseline, z_score, next_recall_date, days_to_recall, followup_complete
        from marts.mart_signals order by month desc, z_score desc""")
    backtest = rows(q, """
        select min_z, ratio, signals, hits, hit_rate, eligible_months, base_rate, lift,
               median_days_to_recall, is_current
        from marts.mart_signal_backtest order by ratio, min_z""")
    # monthly history of every pair that has a signal, as compact arrays
    # (one object per pair) to keep the file small
    series = []
    for r in rows(q, """
        select m.make, m.model, m.component_group, m.month, m.complaints, m.baseline_mean, m.is_signal
        from marts.mart_model_component_monthly m
        join (select distinct make, model, component_group from marts.mart_signals) s
          on s.make = m.make and s.model = m.model and s.component_group = m.component_group
        order by 1, 2, 3, 4"""):
        pair = (r["make"], r["model"], r["component_group"])
        if not series or (series[-1]["make"], series[-1]["model"], series[-1]["component_group"]) != pair:
            series.append({"make": r["make"], "model": r["model"], "component_group": r["component_group"], "start": r["month"],
                           "complaints": [], "baseline": [], "signal": []})
        s = series[-1]
        if r["is_signal"]:
            s["signal"].append(len(s["complaints"]))
        s["complaints"].append(r["complaints"])
        s["baseline"].append(None if r["baseline_mean"] is None else round(r["baseline_mean"], 1))
    # the dashboard lists 20 recalls per view, so ship each make's top 20
    # (which covers the overall top 20) plus campaign counts for the tiles
    recalls = rows(q, """
        select campaign_number, make, model, component_group, report_received_date,
               potentially_affected, complaints_180d_before_recall, complaints_before_recall
        from marts.mart_complaint_to_recall
        where make in (select distinct make from marts.fct_complaints)
        qualify row_number() over (partition by make order by complaints_180d_before_recall desc,
                                   report_received_date desc) <= 20
        order by complaints_180d_before_recall desc, report_received_date desc""")
    recall_counts = rows(q, """
        select make, count(distinct campaign_number) as campaigns
        from marts.fct_recalls group by 1""")
    totals = rows(q, """
        select (select count(distinct odi_number) from marts.fct_complaints) as complaints,
               (select count(distinct campaign_number) from marts.fct_recalls) as recalls,
               (select min(received_month) from marts.fct_complaints) as first_month,
               (select max(month) from marts.mart_model_component_monthly) as last_month,
               (select max(received_date) from marts.fct_complaints) as last_received""")[0]
    data = {
        "meta": {
            "data_label": os.getenv("DATA_LABEL", "SAMPLE").strip(),
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="minutes"),
            **totals,
        },
        "monthly": monthly, "components": components, "signals": signals,
        "series": series, "recalls": recalls, "recall_counts": recall_counts,
        "backtest": backtest,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, separators=(",", ":")))
    print(f"Wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB): "
          f"{len(signals)} signals, {len(recalls)} recalls")


if __name__ == "__main__":
    main()
