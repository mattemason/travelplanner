import { claudeBilling } from "@/lib/billing/claude";
import { googleBilling } from "@/lib/billing/google";

const usd = (n: number) => (n > 0 && n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
const num = (n: number) => n.toLocaleString("en-AU");

/** Usage straight from Anthropic and Google: catches everything, including calls from before the app logged them. */
export async function ProviderBilling() {
  const [claude, google] = await Promise.all([claudeBilling(), googleBilling()]);

  return (
    <section className="mt-8">
      <h2 className="text-[24px] font-bold">From the providers</h2>
      <p className="mt-1 text-[13.5px] text-muted">
        Read from Anthropic and Google directly, so it includes everything, even calls from before the app logged them. Refreshed every 10 minutes.
      </p>

      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-paper p-4">
          <h3 className="text-[20px] font-bold">Claude: actual cost</h3>
          {claude.ok ? (
            <>
              <div className="mt-2 flex gap-6">
                <Stat label="This month" value={usd(claude.monthUsd)} />
                <Stat label="Last 31 days" value={usd(claude.totalUsd)} />
              </div>
              <Bars values={fillDays(claude.days, 31, (d) => d.usd).map(([date, v]) => ({ key: date, v, title: `${date}: ${usd(v)}` }))} colour="#C2662D" />
              <table className="mt-3 w-full text-[13px]">
                <tbody>
                  {claude.lines.slice(0, 10).map((l) => (
                    <tr key={l.description} className="border-t border-line">
                      <td className="py-1.5 pr-2">{l.description}</td>
                      <td className="py-1.5 text-right tabular-nums">{usd(l.usd)}</td>
                    </tr>
                  ))}
                  {!claude.lines.length && (
                    <tr>
                      <td className="py-2 text-muted">No Claude costs in the last 31 days.</td>
                    </tr>
                  )}
                </tbody>
              </table>
              <p className="mt-2 text-[12px] text-muted">Whole organisation: includes any other apps or keys on the same Anthropic account.</p>
            </>
          ) : claude.reason === "not-configured" ? (
            <Setup
              steps={[
                "In the Claude Console, go to Settings › Admin keys (you need to be an organisation admin).",
                "Create an admin key (it starts sk-ant-admin01-).",
                "Add it in Railway as ANTHROPIC_ADMIN_KEY and redeploy.",
              ]}
            />
          ) : (
            <p className="notice notice-bad mt-2">{claude.message}</p>
          )}
        </div>

        <div className="rounded-xl border border-line bg-paper p-4">
          <h3 className="text-[20px] font-bold">Google: actual requests</h3>
          {google.ok ? (
            <>
              <div className="mt-2 flex gap-6">
                <Stat label="This month" value={num(google.methods.reduce((n, m) => n + m.month, 0))} />
                <Stat label="Last 30 days" value={num(google.methods.reduce((n, m) => n + m.last30, 0))} />
              </div>
              <Bars values={fillDays(google.days, 30, (d) => d.count).map(([date, v]) => ({ key: date, v, title: `${date}: ${num(v)} requests` }))} colour="var(--ocean)" />
              <table className="mt-3 w-full text-[13px]">
                <thead className="text-left text-muted">
                  <tr>
                    <th className="py-1 font-bold">API</th>
                    <th className="py-1 text-right font-bold">Month</th>
                    <th className="py-1 text-right font-bold">30 days</th>
                    <th className="py-1 text-right font-bold">List cost, 30 days</th>
                  </tr>
                </thead>
                <tbody>
                  {google.methods.map((m) => (
                    <tr key={m.key} className="border-t border-line">
                      <td className="py-1.5 pr-2">
                        {m.label}
                        {m.errors30 > 0 && <span className="text-bad-ink"> · {num(m.errors30)} failed</span>}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{num(m.month)}</td>
                      <td className="py-1.5 text-right tabular-nums">{num(m.last30)}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {m.high === 0
                          ? "–"
                          : m.low === m.high
                            ? usd((m.last30 * m.high) / 1000)
                            : `${usd((m.last30 * m.low) / 1000)}–${usd((m.last30 * m.high) / 1000)}`}
                      </td>
                    </tr>
                  ))}
                  {!google.methods.length && (
                    <tr>
                      <td className="py-2 text-muted" colSpan={4}>
                        No Maps API requests in the last 30 days.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <p className="mt-2 text-[12px] text-muted">
                Project {google.project}. Costs are before Google&apos;s monthly free allowances (10,000 map loads, 10,000 basic routes,
                5,000 detailed place lookups and so on), so the real bill is usually lower. A range means the price depends on the
                details requested. Failed requests aren&apos;t billed.
              </p>
            </>
          ) : google.reason === "not-configured" ? (
            <Setup
              steps={[
                "In Google Cloud console, open the project that holds your Maps API keys, then IAM & Admin › Service accounts › Create service account.",
                "Give it the Monitoring Viewer role (read-only).",
                "Open the service account › Keys › Add key › JSON. A key file downloads.",
                "Add the file's whole contents in Railway as GOOGLE_SERVICE_ACCOUNT_JSON and redeploy.",
              ]}
            />
          ) : (
            <p className="notice notice-bad mt-2">{google.message}</p>
          )}
        </div>
      </div>
    </section>
  );
}

/** Every day in the last n (UTC dates, oldest first), with 0 for days that had no usage. */
function fillDays<T extends { date: string }>(rows: T[], n: number, value: (r: T) => number): [string, number][] {
  const by = new Map(rows.map((r) => [r.date, value(r)]));
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(today - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return [date, by.get(date) ?? 0];
  });
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[12px] font-bold tracking-wide text-muted uppercase">{label}</p>
      <p className="font-display text-[28px] leading-none font-bold">{value}</p>
    </div>
  );
}

function Bars({ values, colour }: { values: { key: string; v: number; title: string }[]; colour: string }) {
  const max = Math.max(...values.map((x) => x.v), 0);
  if (!max) return null;
  return (
    <div className="mt-3 flex h-20 items-end gap-[2px]" role="img" aria-label="Daily bars">
      {values.map((x) => (
        <div
          key={x.key}
          title={x.title}
          className="flex-1 rounded-t-sm"
          style={{ height: x.v ? `${Math.max(3, (x.v / max) * 100)}%` : "1px", background: x.v ? colour : "var(--line)" }}
        />
      ))}
    </div>
  );
}

function Setup({ steps }: { steps: string[] }) {
  return (
    <div className="mt-2 text-[13.5px]">
      <p className="text-muted">Not connected yet. To connect:</p>
      <ol className="mt-1.5 list-decimal pl-5">
        {steps.map((s) => (
          <li key={s} className="py-0.5">
            {s}
          </li>
        ))}
      </ol>
    </div>
  );
}
