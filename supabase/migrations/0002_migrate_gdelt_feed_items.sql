-- Normalize legacy GDELT feed cards to match current headline + link behavior:
-- 1) "mentions spike" titles -> "index activity"
-- 2) "full content" summaries -> "full coverage"
-- 3) legacy homepage links -> GDELT API artlist search links

-- 1) Update display text first, including legacy payloads like
-- "NVIDIA mentions spike (6h window): 84 mentions".
update content_items ci
set
  headline_generated = regexp_replace(ci.headline_generated, 'mentions spike', 'index activity', 'g'),
  summary_generated = CASE
    WHEN ci.summary_generated IS NOT NULL AND ci.summary_generated LIKE '%full content%' THEN
      replace(ci.summary_generated, 'full content', 'full coverage')
    ELSE ci.summary_generated
  END
from sources s
where ci.item_type = 'gdelt_link'
  and ci.source_id = s.source_id
  and s.name = 'GDELT'
  and (
    ci.headline_generated like '%mentions spike%'
    or (ci.summary_generated is not null and ci.summary_generated like '%full content%')
  );

-- 2) Rewrite legacy homepage links to a searchable GDELT query URL.
with gdelt_items as (
  select
    ci.item_id,
    coalesce(
      nullif(
        substring(
          ci.headline_generated,
          '^(.*?)(?:[[:space:]]+(?:mentions[[:space:]]+spike|index[[:space:]]+activity).*)$'
        ),
        ''
      ),
      'NVIDIA'
    ) as raw_entity
  from content_items ci
  join sources s on s.source_id = ci.source_id
  where ci.item_type = 'gdelt_link'
    and s.name = 'GDELT'
    and ci.external_url like 'https://www.gdeltproject.org/%'
)
update content_items ci
set
  external_url = 'https://api.gdeltproject.org/api/v2/doc/doc?query=' ||
    regexp_replace(coalesce(raw_entity, 'NVIDIA'), '[[:space:]]+', '%20', 'g') ||
    '&mode=artlist&format=html&sort=datedesc&maxrecords=5'
from gdelt_items gi
where ci.item_id = gi.item_id;
