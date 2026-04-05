const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are the editorial AI for Meridian, a serious digital news publication modeled on The Economist and Reuters. Your writing is rigorous, precise, and economical — no marketing language, no hyperbole, no vague claims.

HOUSE STYLE:
- Headline: Sharp, specific, non-clickbait. Under 13 words.
- Subheadline: One sentence that adds information, not just rephrases.
- Byline: "Meridian [X] Desk" (e.g. Meridian Economics Desk)
- 4–6 major sections with descriptive H2 headings
- At least one databox with a specific statistic (labeled KEY FIGURE or CONTEXT)
- One pullquote — a key analytical insight
- End with two know-boxes: "What we know" and "What we don't know"
- Tone: neutral, analytical, precise. No cheerleading. Acknowledge uncertainty explicitly.
- Minimum 700 words in the body.

Return ONLY a valid JSON object — no markdown fences, no preamble:
{
  "category": "one of: Geopolitics, Economics, Finance, Science & Technology, Climate & Energy, Politics, Defence",
  "headline": "string",
  "subheadline": "string",
  "byline": "string",
  "readtime": "N min read",
  "digest": "60-word summary for digest strip",
  "body": "full article HTML using: <h2>, <p>, <div class=\\"databox\\"><strong>LABEL</strong>stat</div>, <div class=\\"pullquote\\">insight</div>, <div class=\\"know-box\\"><h4>What we know</h4><ul><li>point</li></ul></div> and second know-box for What we don't know"
}`;

// Generate article endpoint
app.post('/api/generate', async (req, res) => {
  const { topic } = req.body;
  if (!topic) return res.status(400).json({ error: 'Topic required' });

  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Stream pipeline stage updates
    const stages = ['Topic Discovery', 'Source Synthesis', 'Fact Framework', 'Draft Generation', 'Editorial Pass', 'Publication'];
    for (let i = 0; i < stages.length - 1; i++) {
      res.write(`data: ${JSON.stringify({ type: 'stage', stage: i, label: stages[i] })}\n\n`);
      await new Promise(r => setTimeout(r, 1800));
    }

    const message = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Write a full Meridian article on this topic: "${topic}"\n\nUse real-world context and be specific and analytical.` }]
    });

    let text = message.content[0].text.trim().replace(/```json|```/g, '').trim();
    // Extract JSON if wrapped
    const match = text.match(/\{[\s\S]*\}/);
    if (match) text = match[0];
    const article = JSON.parse(text);

    res.write(`data: ${JSON.stringify({ type: 'stage', stage: stages.length - 1, label: stages[stages.length - 1] })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'article', article })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error(err);
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  }
});

// Q&A endpoint
app.post('/api/qa', async (req, res) => {
  const { question, articleHeadline, articleBody } = req.body;
  if (!question || !articleHeadline) return res.status(400).json({ error: 'Missing fields' });

  try {
    const bodyText = articleBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 1200);
    const message = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 400,
      system: `You are Meridian's editorial AI answering reader questions about articles. Be concise, precise, and analytically grounded. 2–4 sentences max. No fluff. Acknowledge uncertainty where it exists.`,
      messages: [{
        role: 'user',
        content: `Article: "${articleHeadline}"\nSummary: ${bodyText}\n\nReader question: ${question}\n\nAnswer directly.`
      }]
    });
    res.json({ answer: message.content[0].text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Serve index for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Meridian running on http://localhost:${PORT}`));
