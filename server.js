require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are GM Navigation AI for Jordan Kim's 2024 Blazer EV AWD. Battery: 73% (212mi). Charging: Electrify America preferred, 20-min max, 80% min departure. Routes: Chicago commute 18mi, Milwaukee 92mi, O'Hare 27mi. OnStar: Safety & Security. School pickup Tue/Thu 3:15pm. Highway preferred, tolls OK, climate 70°F.

RULES: Voice-first — 2-3 sentences MAX. One action, one number, one next step. No lists. Lead with the answer.

CAPABILITIES: EV charging optimization (EA/ChargePoint/EVgo), multi-stop routing, OnStar safety, Super Cruise HD map awareness, myChevrolet app handoff, vehicle telemetry, POI routing.

Respond ONLY with valid JSON, no markdown:
{"reply":"spoken response","action":"route_planned|charging_optimized|safety_alert|poi_added|multi_stop_optimized|diagnostic_check|info_response|onstar_triggered|super_cruise_update|mobile_app_handoff","route_type":"standard|ev_optimized|multi_stop|safety|null","confidence":"high|medium|low","onstar_triggered":false,"proactive_suggestion":"tip or null","driver_emotion":"calm|curious|stressed|urgent|frustrated"}`;

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;
  const trimmed = messages.slice(-8); // keep last 8 messages to cap token cost

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: trimmed
    });

    let raw = response.content[0].text.trim();
    // Strip markdown code fences Claude sometimes adds despite instructions
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    // Extract JSON object if embedded in surrounding text
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) raw = jsonMatch[0];

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      parsed = {
        reply: raw,
        action: 'info_response',
        route_type: null,
        confidence: 'medium',
        onstar_triggered: false,
        proactive_suggestion: null,
        driver_emotion: 'calm'
      };
    }

    res.json(parsed);
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: error.message || 'Failed to get response' });
  }
});

app.post('/api/feedback', (req, res) => {
  const { feedback, rating, conversation } = req.body;
  if (!feedback || !feedback.trim()) {
    return res.status(400).json({ error: 'Feedback text is required' });
  }

  const entry = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    rating: rating || null,
    feedback: feedback.trim(),
    conversationLength: conversation || 0
  };

  const FEEDBACK_FILE = path.join(__dirname, 'feedback.json');
  let existing = [];
  try { existing = JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf8')); } catch (e) {}
  existing.push(entry);
  fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(existing, null, 2));

  console.log(`Feedback saved [${entry.timestamp}]: ${rating ? rating + '★ ' : ''}${feedback.trim().substring(0, 60)}`);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`GM Navigation AI demo running at http://localhost:${PORT}`);
});
