/** Default ICP / outreach criteria when `LEAD_SCORING_CONTEXT` is not set in `.env`. */
export const DEFAULT_LEAD_SCORING_CONTEXT = `Ideal customers: small businesses and solopreneurs (roughly 1–50 employees, or owner-operated teams) who want to implement AI into how they run the business.

What we are selling: AI agents and workflow automation (primary focus), plus AI consulting, custom apps, and SaaS builds when that is the right fit.

Strong fit signals:
- Contact is founder, owner, GM, or operator with real influence over tools and spend
- Obvious repetitive workflows: lead follow-up, intake, scheduling, dispatch, CRM hygiene, client updates, qualification, quoting
- Growth, hiring, or capacity pressure where automation would remove bottlenecks
- Industries where speed-to-lead and follow-up matter (real estate, legal, home services, agencies, professional services, e-commerce, coaching, local services, etc.)

Weak or poor fit signals:
- Large enterprise with long procurement and no clear champion
- Junior or non-decision-maker with no path to the buyer
- No plausible automation wedge from available data
- Company size or model that suggests custom enterprise builds only, with no SMB-style workflow pain
- Invalid, generic, or contradictory lead data

Scoring scale (0–100):
- 80–100 hot: strong ICP match, clear automation angle, credible decision-maker access
- 60–79 warm: good fit with one gap (e.g. weaker trigger or role ambiguity)
- 40–59 neutral: possible fit but needs validation or more research
- 20–39 cold: weak fit or low priority for outbound right now
- 0–19 disqualified: clear mismatch or unusable lead`;
