import { Link } from "react-router-dom";

export function NotFoundPage(): JSX.Element {
  return (
    <section className="page-wrap">
      <article className="glass-panel card-stack">
        <h1>Not Found</h1>
        <Link to="/" className="external-link">
          Return Home
        </Link>
      </article>
    </section>
  );
}

