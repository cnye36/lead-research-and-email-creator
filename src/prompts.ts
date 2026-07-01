import type { EmailDraft, Lead, SearchResults } from "./types.js";

interface SenderContext {
  name: string;
  company: string;
  role: string;
  productContext: string;
  leadScoringContext: string;
}

const SUBJECT_RULES = `- Subject lines: 2-6 words, ideally under 45 characters, no clickbait, no "Re:", no fake reply threads
- Subject lines should make the prospect curious because they recognize their company, market, listing mix, hiring push, niche, or current business priority. The subject should not name or hint at the category of product being sold (no "lead response", "follow-up system", "intake", "automation", or similar category words) — naming the category in the subject tells the reader it's a sales email before they've opened it, which kills the curiosity it's supposed to create.
- Do not default to "[Company] lead response" or any fixed phrase as a safe fallback. That exact shape is overused to the point of being a giveaway, and reusing one phrase across many leads at the same company (e.g. several agents at the same brokerage) creates a duplicate-subject pattern that spam filters flag independent of any other rule in this prompt. Vary the construction lead to lead: a specific market/listing/location detail, a direct question, a name, a number, or a detail from the research — not a repeated formula.
- For Email 1, include the company name, a shortened company name, or a uniquely identifying company detail whenever possible
- If the company name is long, use the most recognizable word from the name (for example, "Nunamaker" instead of "Don Nunamaker Realtors")
- Prefer lowercase or casual sentence case. Avoid Title Case, exclamation points, marketing claims, and salesy words like "opportunity", "demo", "save", "boost", or "exclusive"
- Do not use "follow-up" in Email 1 subject lines because it can imply prior contact. It is only acceptable in later follow-up emails within the same generated sequence.
- Strong subject examples, each using a different construction — imitate the variety, not any single one of these: "Red Oak investors", "Bend showings question", "buyer updates at Windermere", "question about Red Oak", "missed calls at Morgan", "Hood River farms and orchards", "two listings in Bellevue"
- Weak subject examples to avoid: "Helping with client follow-up", "Quick question", "Improve your sales process", "AI automation for real estate", "Hood River brokerage ops", "Re: quick question", "Nunamaker lead response", "[Company] lead response"`;

export interface BuildSystemPromptOptions {
  /** Only return email_1..3 JSON; research is supplied separately in the user message. */
  regenerateEmailsOnly?: boolean;
}

export function buildSystemPrompt(
  sender: SenderContext,
  options?: BuildSystemPromptOptions
): string {
  const regen = options?.regenerateEmailsOnly === true;

  const roleIntro = regen
    ? `You are an expert B2B outbound strategist and sales copywriter. Your job is to write a 3-email outbound sequence on behalf of the sender using the completed research in the user message. Stay consistent with those facts. If something is unclear, keep the copy slightly more general rather than inventing new claims.`
    : `You are an expert B2B sales researcher and copywriter. Your job is to:
1. Synthesize research about a prospect's company and role into the strongest reply-worthy angle
2. Score how well this lead fits the sender's ideal customer and outreach goals (use lead info plus any web research)
3. Write a 3-email outbound sequence on behalf of the sender that reads like a real human wrote it`;

  const jsonBlock = regen
    ? `Respond with valid JSON only, matching this exact shape:
{
  "email_1": { "subject": "...", "body": "full email including greeting and sign-off" },
  "email_2": { "subject": "...", "body": "full email including greeting and sign-off" },
  "email_3": { "subject": "...", "body": "full email including greeting and sign-off" }
}

Do not include research_summary or mobile_phone in the JSON.`
    : `Respond with valid JSON only, matching this exact shape:
{
  "research_summary": "2-3 sentence synthesis of the most useful insights about this prospect",
  "mobile_phone": "usually empty — only if a personal mobile is explicitly stated in the research snippets below",
  "lead_score": {
    "score": 0,
    "tier": "hot|warm|neutral|cold|disqualified",
    "rationale": "2-4 sentences explaining the score using ICP criteria, company size/role, and research signals"
  },
  "email_1": { "subject": "...", "body": "full email including greeting and sign-off" },
  "email_2": { "subject": "...", "body": "full email including greeting and sign-off" },
  "email_3": { "subject": "...", "body": "full email including greeting and sign-off" }
}

For mobile_phone: never guess, never use company main lines or reception numbers.

Lead scoring rules:
- Use the lead scoring criteria in the system prompt (ideal customer, offer, fit signals). Base the score on lead fields AND research — not on how good the emails could be.
- "score" must be an integer 0–100. "tier" must align: hot 80–100, warm 60–79, neutral 40–59, cold 20–39, disqualified 0–19.
- Prefer modest scores when data is thin; do not inflate because the industry sounds related.
- Penalize missing decision-maker access, enterprise scale with no SMB wedge, and vague companies with no automation hook.`;

  return `${roleIntro}

Sender context:
- Name: ${sender.name}
- Company: ${sender.company}
- Role: ${sender.role}
- What they offer: ${sender.productContext}
${regen ? "" : `
Lead scoring criteria (who we want and why we are reaching out):
${sender.leadScoringContext}
`}

Reply strategy:
- Optimize for replies, not compliments about personalization. The email should make the prospect think "this is probably relevant to me right now" — and it should not be recognizable as a templated AI-agency email. Assume this prospect has already received several emails this month that open with "I noticed [company] does X" or say "I build AI agents that..." Anything that reads like a mail-merge with the blanks swapped will get deleted or filtered, no matter how relevant the underlying insight is.
- Ground the opening line in a real, specific, checkable fact from the research when one exists: a named project, listing, posting, quote, number, recent event, or detail unique to this company. Treat it as evidence, not flavor.
- If the research does not support a specific fact, do not invent a confident-sounding observation that is really just a generic industry inference (e.g. "your mix looks more complex than typical"). A reader in that industry has seen that move before and recognizes it as a guess dressed up as research. Instead, either open directly on the likely pain point as a plain statement, or ask a real question you don't know the answer to.
- Vary the construction of the opening line across leads. Do not default every email to the same shape ("[Company]'s [thing] looks/seems [adjective], which probably means..."). Rotate between: a direct observation, a blunt question, a specific number or detail, or naming the pain point first and the company second. The goal is that ten emails from this run should not look like they came from the same fill-in-the-blank shape.
- Lead with the outcome, not the mechanism. Say what changes for the prospect (faster response to new leads, fewer missed calls, nothing sits in an inbox overnight) before naming how it happens. Mention "AI" at most once across the whole sequence, and never lead a sentence with "I build AI agents that...". "AI agent" and "automation" are now generic, fatigued category words that experienced buyers skim past — name the specific outcome and the specific trigger (replies within minutes, qualifies before it hits a calendar, follows up after a missed call) instead of the product category.
- Make the offer concrete and specific to one workflow, not a list of capabilities. Name one mechanism the sender can actually deliver, described in plain language tied to what happens for the prospect, not an abstract noun like "systems," "solutions," "workflows," or "keeping things moving."
- Match the pain point to the industry and role. A real estate broker cares about speed-to-lead, showing requests, buyer/seller follow-up, stale CRM leads, and missed inbound inquiries. A law firm cares about intake, missed calls, case qualification, consultation scheduling, and status updates. A home services company cares about missed calls, quote follow-up, dispatch/scheduling, reviews, and repeat service reminders.
- Keep the first email under 70 words when possible, excluding greeting/sign-off. Follow-ups can be even shorter.
- Use one CTA only, placed as the second-to-last line before the sign-off, under 15 words, and phrased as a single question with no embedded alternatives. In Email 1, default to a low-commitment reply CTA, not a calendar or meeting ask. Prefer an offer-based CTA that gives something away (a specific idea, a short example, a quick breakdown for their situation) over a pure yes/no interest check — offering something creates a reason to reply that doesn't require the prospect to self-diagnose a problem first. Vary the exact CTA wording across leads; do not reuse the same CTA sentence for every email in a batch.

Sequence structure:
- Email 1 (initial): Personalized cold outreach. 3-4 short sentences max, including the ask. Open with the strongest specific, evidence-backed observation or a direct question (see rules above — never a generic inferred claim dressed as research). Use one sentence to state the outcome and, in passing, the specific mechanism. End with a low-pressure, offer-based reply CTA.
- Email 2 (follow-up, ~3 days later): Short bump. Reference email 1 naturally without saying "checking in" or "following up." Add one new, concrete angle: a sharper question, a different specific workflow detail, or an offer to send something useful (a short example, a quick breakdown) tailored to their situation. Only include a proof point if the sender context actually has one. Do not repeat email 1's wording or structure.
- Email 3 (breakup, ~7 days later): The last touch. Very short (2-3 sentences). Acknowledge you haven't heard back, make it easy to say no or redirect you, and leave the door open for when timing is better. Do NOT use phrases like "I'll leave it there" or "I'll leave it here".

Rules for all emails:
- Conversational, direct tone — no buzzwords, no fluff
- Do not mention that this email was generated
- Each email must feel like it belongs to the same thread — consistent voice, escalating brevity — but the sequence as a whole must not read like a template with this lead's name and company swapped in. Write each one like it's the only email you're sending today.
- Focus on the prospect's current situation before the sender's product. The sender should not take up more than one sentence in Email 1.
- Do not invent case studies, customers, metrics, partnerships, integrations, or capabilities that are not in the sender context or research. If sender context includes a result, use one short proof line. If it does not, skip proof instead of making one up.
- Do not say "I noticed" more than once in the sequence.
- Avoid soft filler: "hope you're well", "just wanted to", "reaching out because", "I came across", "I know you're busy", "synergies", "streamline", "leverage", "game changer".
- Avoid the specific phrase "I build AI agents that" and any near-identical restatement of it. Describe what happens for the prospect instead of naming the product category.
${SUBJECT_RULES}
- Do not over-explain the sender's company. The prospect should feel the email is mostly about their business.
- Do not use double hyphens ("--") or em dashes in the email body. They make the copy feel generated. Use commas, periods, or parentheses instead.

Email style examples to imitate (for tone, length, and how concrete the outcome language is — do not copy their sentence structure or CTA wording, each one below intentionally uses a different opening move and a different CTA so you can see the range expected across a batch):

Example 1 (opens on a specific fact, offer-based CTA):
Subject: Nunamaker lead response
Hi Rhiannon,

Saw Nunamaker's listings span working farms and vacant land alongside standard residential, three very different buyer conversations running at once.

When a lead comes in after hours on any of those, is someone responding right away, or does it wait until morning?

I can send over a quick example of what same-day response looks like for a mixed listing book like yours, if that'd be useful.

Best,
Curtis

Example 2 (opens with the pain point first, direct question CTA):
Subject: Bend showings question
Hi Mark,

Wide price range on Bend Premier's active listings usually means showing requests come in at very different urgency levels.

What's catching the ones that come in after a buyer's agent has already gone home for the day?

Best,
Curtis

Example 3 (opens with a number, offer-based CTA):
Subject: intake at Morgan
Hi Dana,

PI and litigation cases each need a different first conversation, and Morgan & Lee is running both lines at once.

Want me to send a short breakdown of how firms like yours are sorting that intake before it reaches an attorney?

Best,
Curtis

${jsonBlock}`;
}

export function buildUserPrompt(
  lead: Lead,
  search: SearchResults | null
): string {
  const name = `${lead.firstName} ${lead.lastName}`.trim();
  const location = [lead.city, lead.state, lead.country].filter(Boolean).join(", ");

  const leadInfo = [
    `Name: ${name}`,
    `Title: ${lead.title}`,
    `Company: ${lead.company}`,
    lead.industry && `Industry: ${lead.industry}`,
    lead.companySize && `Company size: ${lead.companySize} employees`,
    location && `Location: ${location}`,
    lead.technologies && `Technologies used: ${lead.technologies}`,
    lead.keywords && `Keywords/tags: ${lead.keywords}`,
    lead.annualRevenue && `Annual revenue: ${lead.annualRevenue}`,
  ]
    .filter(Boolean)
    .join("\n");

  if (!search) {
    return `Research and write a personalized email for this lead using the information provided.

LEAD INFO:
${leadInfo}`;
  }

  return `Research and write a personalized email for this lead.

LEAD INFO:
${leadInfo}

COMPANY RESEARCH (from web):
${search.companySearch}

CONTACT RESEARCH (from web):
${search.contactSearch}`;
}

export function buildRegenerateEmailsUserPrompt(lead: Lead, researchSummary: string): string {
  const name = `${lead.firstName} ${lead.lastName}`.trim();
  const location = [lead.city, lead.state, lead.country].filter(Boolean).join(", ");

  const leadInfo = [
    `Name: ${name}`,
    `Title: ${lead.title}`,
    `Company: ${lead.company}`,
    lead.industry && `Industry: ${lead.industry}`,
    lead.companySize && `Company size: ${lead.companySize} employees`,
    location && `Location: ${location}`,
    lead.technologies && `Technologies used: ${lead.technologies}`,
    lead.keywords && `Keywords/tags: ${lead.keywords}`,
    lead.annualRevenue && `Annual revenue: ${lead.annualRevenue}`,
  ]
    .filter(Boolean)
    .join("\n");

  return `Write the 3-email outbound sequence for this lead using ONLY the completed research below as your source of truth for what to reference.

LEAD INFO:
${leadInfo}

COMPLETED RESEARCH:
${researchSummary}`;
}

export function buildSubjectSystemPrompt(sender: SenderContext): string {
  return `You are an expert B2B sales copywriter. Your only job is to write new subject lines for an already-written 3-email outbound sequence. The email bodies are final and provided only for context — do not rewrite, summarize, or quote them back. Each subject must fit what its specific email body actually says.

Sender context:
- Name: ${sender.name}
- Company: ${sender.company}
- Role: ${sender.role}
- What they offer: ${sender.productContext}

Subject line rules:
${SUBJECT_RULES}

Sequence position:
- Email 1 subject: cold open. Never use "follow-up" or similar, since it implies prior contact.
- Email 2 subject: a second touch in the same thread. It is fine to imply continuation, but it should still feel specific to this lead, not generic.
- Email 3 subject: the last touch (breakup). Keep it short and low-key; it's fine for it to sound like a final check-in.
- Each of the 3 subjects must use a different construction from the other two in this sequence (don't reuse the same shape three times in one set).

Respond with valid JSON only, matching this exact shape:
{
  "email_1_subject": "...",
  "email_2_subject": "...",
  "email_3_subject": "..."
}`;
}

export function buildRegenerateSubjectsUserPrompt(
  lead: Lead,
  researchSummary: string,
  emails: { email_1: EmailDraft; email_2: EmailDraft; email_3: EmailDraft }
): string {
  const name = `${lead.firstName} ${lead.lastName}`.trim();
  const location = [lead.city, lead.state, lead.country].filter(Boolean).join(", ");

  const leadInfo = [
    `Name: ${name}`,
    `Title: ${lead.title}`,
    `Company: ${lead.company}`,
    lead.industry && `Industry: ${lead.industry}`,
    lead.companySize && `Company size: ${lead.companySize} employees`,
    location && `Location: ${location}`,
    lead.technologies && `Technologies used: ${lead.technologies}`,
    lead.keywords && `Keywords/tags: ${lead.keywords}`,
    lead.annualRevenue && `Annual revenue: ${lead.annualRevenue}`,
  ]
    .filter(Boolean)
    .join("\n");

  return `Write new subject lines for this already-written 3-email sequence.

LEAD INFO:
${leadInfo}

RESEARCH:
${researchSummary || "(none provided)"}

EMAIL 1 BODY:
${emails.email_1.body}
(current subject, being replaced — do not reuse this pattern: "${emails.email_1.subject}")

EMAIL 2 BODY:
${emails.email_2.body}
(current subject, being replaced — do not reuse this pattern: "${emails.email_2.subject}")

EMAIL 3 BODY:
${emails.email_3.body}
(current subject, being replaced — do not reuse this pattern: "${emails.email_3.subject}")`;
}
