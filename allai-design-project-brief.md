# allai.design — Project Brief

**Domain:** allai.design  
**Owner:** Oykun Yilmaz  
**Status:** Pre-launch  
**Last updated:** June 2026

---

## The idea

A curated destination for everything at the intersection of AI and design. Not another aggregator. Not a paywalled playbook. A place where designers get the signal without the noise — picked and framed by someone who actually ships AI products.

The gap in the market is real: recent.design has great taste but ignores AI. aiverse.design has great AI coverage but it's paywalled and skews academic. allai.design sits in the open middle: free, daily, opinionated, and growing.

---

## Why this domain, why now

- "allai.design" reads as "all AI design" — the scope is in the name
- The .design TLD signals credibility to the target audience immediately
- AI design as a discipline is maturing fast. The moment for a dedicated curation resource is now, before the space consolidates around a few incumbents
- Oykun has firsthand experience designing AI products at scale. This isn't a side observer playing curator — it's practitioner perspective

---

## Audience

**Primary:** Mid-to-senior product designers and design leads who are building AI features or redesigning around AI workflows. They read newsletters, follow design Twitter, and are already trying to figure out AI — they just don't have a trusted filter.

**Secondary:** Product managers and founders who work closely with design, especially at startups building AI-native products.

**Not the audience:** Researchers, ML engineers, prompt engineers, or people looking for pure engineering content.

**Audience mindset:** Busy, taste-aware, skeptical of hype, don't want to feel behind. They'll share something good but they'll unsubscribe fast if the quality drops.

---

## Positioning

| Site | Focus | Paywall | Oykun's take |
|---|---|---|---|
| recent.design | Design inspiration (all categories) | No | Great taste, no AI focus |
| aiverse.design | AI UX patterns + playbook | Yes (Pro) | Deep but locked, skews educational |
| mobbin.com | Mobile UI library | Freemium | No editorial voice |
| allai.design | Everything AI x Design, curated | No | The open, opinionated version |

The pitch: **the best AI design content on the internet, free, with an expert point of view.**

---

## Content pillars

### 1. Visual curation
AI-generated interfaces, AI product screenshots, generative outputs worth seeing. Think recent.design's format, AI-only. Updated regularly. Filtered hard — only what's actually worth seeing.

Tags: `#ui` `#interface` `#generative` `#prototype`

### 2. AI design patterns
Named, categorised UX patterns from real AI products. How the best products handle: streaming text, loading states, error handling, onboarding to AI features, confidence indicators, prompt inputs, multi-step agents, memory/context surfacing.

Each pattern entry: name, what it solves, 2-4 real examples with screenshots, Oykun's verdict.

Tags: `#pattern` `#ux` `#interaction`

### 3. Articles
Curated links to the best writing on AI design, UX research, and product thinking. One-liner curation note from Oykun on why it's worth reading. Never just a link dump — always a reason.

Tags: `#read` `#research` `#opinion`

### 4. Tools
AI tools for designers — image generation, research, copy, prototyping, Figma plugins, workflow automation. Short verdict: Must-have / Worth trying / Not yet. Honest, including the limitations.

Tags: `#tool` `#figma` `#workflow` `#imagegen`

### 5. Product teardowns
Longer-form breakdowns (500–800 words) of one AI product's design decisions. What works, what doesn't, what's worth stealing. Published less frequently but high-value.

Tags: `#teardown` `#analysis`

---

## Editorial standards

Every piece of content on allai.design passes this filter:

1. **Would Oykun share this?** Not "is it AI design content" — is it actually worth someone's time?
2. **Does it have a point of view?** Pure aggregation with no angle is noise. Always add a take.
3. **Is the taste right?** The visual curation bar is high. If it's not well-executed, it doesn't go up regardless of the idea.
4. **Does it respect the reader's time?** Short, dense, no filler. One idea per item.

---

## Site structure (v1)

```
allai.design/
├── / (home — recent curation across all pillars)
├── /patterns (AI design patterns library)
├── /tools (AI tools for designers)
├── /articles (curated reads)
├── /teardowns (product analysis)
└── /newsletter (subscribe + archive)
```

---

## Newsletter

The newsletter is the most important distribution channel. Email is owned, algorithm-proof, and what sponsors actually pay for.

**Format:** Weekly digest. 5–7 items across the pillars. One short editorial note from Oykun at the top. Under 3 minutes to read.

**Name idea:** All AI Design Weekly / The allai.design digest

**Goal milestones:**
- 500 subscribers → validation
- 2,000 subscribers → start approaching small sponsors
- 5,000 subscribers → meaningful sponsorship conversations
- 10,000+ subscribers → primary monetization channel

---

## Monetization path

**Stage 1 (0–6 months): Build the audience**
No monetization. Focus on quality, consistency, and subscriber growth. Post on X/Twitter. Cross-promote via Designer Mindset.

**Stage 2 (6–12 months): First sponsors**
Target: design tools and AI companies that want to reach practitioners. Single sponsor per newsletter issue. Rate based on subscriber count (benchmark: $20–40 CPM for a design audience).

Potential sponsors: Figma, Framer, Spline, Maze, Lottiefiles, Runway, ElevenLabs, Notion, Linear, Webflow, Anthropic, design course platforms.

**Stage 3 (12–24 months): Diversify**
- Sponsored pattern deep-dives (companies pay to have their AI product featured in a teardown — editorial stays honest, clearly marked as sponsored)
- Job board (design roles at AI companies)
- Affiliate links on tools section
- Paid resource packs (cheatsheets, pattern libraries)

---

## Growth strategy

**Primary:** Organic search + X/Twitter. AI design is being searched heavily right now. Patterns pages especially have SEO potential.

**Cross-promotion:** Every Designer Mindset newsletter issue can reference allai.design. Oykun's bank design authority and personal brand on X already seeds the initial audience.

**Content leverage:** Each teardown becomes a Twitter thread. Each tool pick becomes a tweet. Each pattern becomes a post. One piece of curation = multiple distribution touchpoints.

**Submission:** Eventually open a submission form so the community surfaces content. Reduces curation effort as the site grows.

---

## Tech stack considerations

Keep it lean. This runs alongside a full-time job.

**Good options:**
- Static site (Astro, Next.js) + Markdown files = fast, free, easy to maintain
- Webflow = no-code, fast setup, easy to update
- Ghost = built-in newsletter, clean CMS, designed for exactly this use case

**Newsletter:** Kit (formerly ConvertKit) or Ghost's built-in. Should integrate with whatever the site is built on.

**Avoid:** Anything that requires ongoing maintenance overhead or complex databases in v1.

---

## Time reality

Oykun is running this alongside a full-time job at a bank and building Designer Mindset. This means:

- Content should be batchable (set aside 1–2 hours on Sunday to queue the week)
- Curation cadence should be sustainable before it's ambitious (3x/week beats daily if daily burns out by month 2)
- Automation is a friend: RSS feeds, AI-assisted research, saved searches on X
- The newsletter is the forcing function — weekly publish deadline keeps the site updated

---

## Success metrics (12-month horizon)

| Metric | Target |
|---|---|
| Monthly unique visitors | 10,000+ |
| Newsletter subscribers | 5,000+ |
| Newsletter open rate | 40%+ |
| First paid sponsorship | Month 8–10 |
| Teardowns published | 12 |
| Patterns documented | 30+ |
| Tools reviewed | 50+ |

---

## What this is NOT

- A blog about Oykun's opinions on AI (that's Designer Mindset)
- A tool comparison site (curation with verdict, not comprehensive reviews)
- A job board (maybe later, not now)
- A community (allai.design points people to Designer Mindset for that)
- An AI-generated content site (human curation is the product)

---

## Connection to Designer Mindset

allai.design is top-of-funnel for Designer Mindset. The progression: discover allai.design → subscribe to newsletter → follow Oykun on X → join Designer Mindset community.

Don't push the community hard from allai.design, but make it easy to find. Footer link, occasional mention in the newsletter. Trust first.
