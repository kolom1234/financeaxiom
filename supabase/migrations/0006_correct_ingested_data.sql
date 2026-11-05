-- 0006: correct data written by earlier ingest code.

-- 1) "US GDP QoQ" was computed as the percent change of BEA NIPA Table 1.1.1
--    values. Table 1.1.1 already contains "Percent Change From Preceding Period
--    in Real Gross Domestic Product" (seasonally adjusted at annual rates), so the
--    stored values were a % change of growth rates. The series is derived data we
--    generated ourselves; it is removed and replaced by US_REAL_GDP_GROWTH_SAAR,
--    which stores the published values unchanged.
delete from public.series
where series_code = 'US_GDP_QOQ'
  and is_derived = true
  and derivation->>'method' = 'qoq_from_bea_levels';

-- 2) US CPI YoY was derived from the seasonally adjusted index (CUSR0000SA0) by
--    array position, which misaligns every month after a missing period (BLS
--    published no October 2025 value). Drop the derived observations; the next
--    BLS run recomputes them from the unadjusted index (CUUR0000SA0) by date.
delete from public.series_observations so
using public.series s
where so.series_id = s.series_id
  and s.series_code = 'US_CPI_YOY'
  and s.is_derived = true
  and coalesce(s.derivation->>'method', '') <> 'yoy_date_matched';

-- 3) SEC filing items were re-dated to the ingest time on every poll. Restore
--    the SEC acceptance time where it is known.
update public.content_items ci
set event_time = f.accepted_at
from public.filings f
where ci.item_type = 'sec_filing'
  and ci.meta->>'accession' = f.accession
  and f.accepted_at is not null
  and ci.event_time is distinct from f.accepted_at;

-- 4) Register NVIDIA's SEC CIK so filings link to the issuer by CIK.
update public.entities
set cik = '0001045810', updated_at = now()
where slug = 'nvidia'
  and cik is null;
