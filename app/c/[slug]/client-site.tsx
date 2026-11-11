import BrandLogo from "../../brand-logo";
import OperableGate from "../../operable-gate";

export default function ClientSite({ name, state, slug }: { name: string; state: "waiting" | "unavailable"; slug: string }) {
  return (
    <main className="mk-client">
      <header className="mk-client-header">
        <BrandLogo tone="dark" />
        <div>
          <p>Magic Keys portal</p>
          <h1>{name}</h1>
        </div>
      </header>
      <div className="mk-client-body">
        {state === "unavailable" ? (
          <section className="mk-client-panel" role="alert">
            <h2>This page could not be loaded</h2>
            <p>The site name did not come back. Nothing was changed, and this page does not open a gate.</p>
            <a className="mk-client-retry" href={`/c/${slug}`}>Try again</a>
          </section>
        ) : (
          <>
            <section className="mk-client-panel" aria-labelledby="mk-client-about">
              <h2 id="mk-client-about">This site only</h2>
              <p>This page is for {name}. It does not show any other client. On a computer it is this same page in the Magic Keys portal. Sign-in is not switched on for this site yet. When it is, people for this site are added and removed here.</p>
            </section>
            <section className="mk-client-panel" aria-labelledby="mk-client-people">
              <h2 id="mk-client-people">People</h2>
              <p>No one is listed on this page yet. The list appears after sign-in is switched on. A phone that has not been added cannot open the gate.</p>
            </section>
            <section className="mk-client-panel" aria-labelledby="mk-client-gate">
              <h2 id="mk-client-gate">Gate</h2>
              <OperableGate name={name} kind="single-swing" area={name} />
              <p>OPEN and CLOSE move the picture. They do not pulse the unit. Where the unit is commissioned, an allowed phone opens it by calling the unit.</p>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
