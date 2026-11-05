import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { FeedItemPayload } from "@ofp/shared";
import { getEntity } from "../lib/api";
import { buildGdeltDisplayMeta } from "../lib/gdeltDisplay";
import { buildGdeltSourcePreviewUrl, resolveOpenSourceUrl } from "../lib/feedLinks";
import { SourceBadge } from "../components/SourceBadge";
import { LicenseBadge } from "../components/LicenseBadge";

export function EntityPage(): JSX.Element {
  const { slug = "" } = useParams();
  const [entityName, setEntityName] = useState(slug);
  const [items, setItems] = useState<FeedItemPayload[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setNotice(null);
    void getEntity(slug).then((result) => {
      if (!active) {
        return;
      }
      if (result.status === "ok") {
        setEntityName(result.data.entity.name);
        setItems(result.data.items);
        setNotice(result.data.items.length === 0 ? "No indexed items for this entity yet." : null);
        return;
      }
      setItems([]);
      setNotice(result.status === "not_found" ? "Entity not found." : `Entity feed is temporarily unavailable: ${result.message}`);
    });
    return () => {
      active = false;
    };
  }, [slug]);

  return (
    <section className="page-wrap">
      <header className="glass-panel page-header">
        <h1>{entityName}</h1>
        <p className="muted-copy">Entity feed includes self-generated headlines only.</p>
      </header>
      {notice ? (
        <p className="system-banner glass-panel" role="status">
          {notice}
        </p>
      ) : null}
      <ul className="feed-list">
        {items.map((item) => (
          <li key={item.item_id} className="feed-card glass-panel">
            <div className="feed-topline">
              <SourceBadge source={item.source} />
              <LicenseBadge license={item.license} />
            </div>
            {item.item_type === "gdelt_link" ? (
              <>
                <h2 className="feed-headline">{buildGdeltDisplayMeta(item).title}</h2>
                <p className="feed-summary gdelt-summary">{buildGdeltDisplayMeta(item).compactMeta}</p>
              </>
            ) : (
              <h2 className="feed-headline">{item.headline}</h2>
            )}

            {(() => {
              const openSourceUrl =
                item.item_type === "gdelt_link" ? buildGdeltSourcePreviewUrl(item) : resolveOpenSourceUrl(item);
              if (openSourceUrl) {
                return (
                  <a href={openSourceUrl} target="_blank" rel="noopener noreferrer" className="external-link">
                    Open source
                  </a>
                );
              }
              return <span className="external-link disabled">Open source unavailable</span>;
            })()}
            <p className="feed-footnote">{item.license.attribution_text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
