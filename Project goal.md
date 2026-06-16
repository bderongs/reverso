Project goal

We want to build an MVP evaluation system for language-learning articles used in an app similar to Reverso Reader.

The user has hundreds of short English-learning articles. Each article has:

a URL
a target CEFR level, provided in a CSV
text content
highlighted learning words/phrases marked with <em> tags

The goal is to use an LLM to rate each article on a few criteria, each scored from 1 to 5, and output the results in a CSV.

The deeper product goal is not only “is this text pedagogically useful?” but:

When a learner reads this, will they feel: “Wow, this is good content”, not just “this is a vocabulary exercise”?

Original criteria considered

We first discussed many possible quality criteria:

CEFR level fit
category relevance
vocabulary usefulness
context quality
engagement
naturalness
coherence
highlight quality
safety/sensitivity
pedagogical usefulness

Then we simplified.

The user removed:

naturalness
coherence
context quality

Then later removed:

category relevance
vocabulary usefulness

Reason: the articles are generally already strong on category relevance and vocabulary usefulness.

Current MVP criteria

The current MVP criteria are:

Level fit
Highlight selection
Engagement
Freshness

No decision rules yet. No “keep/revise/reject” classification yet. No overall score rules yet.

The script should simply output one score from 1 to 5 for each criterion.

Input/output structure

Input CSV:

url,target_level,category
https://example.com/article-1,B2,Emergency response
https://example.com/article-2,C1,Business communication

Even though category may be included, category relevance is no longer scored.

Output CSV should include:

url,target_level,category,level_fit,highlight_selection,engagement,freshness,strengths,issues,error
Script concept

The MVP script:

Reads a CSV of URLs, target levels, and categories.
Fetches each URL.
Extracts article HTML while preserving <em> tags.
Sends the article HTML, target level, and rubric to an LLM.
Receives valid JSON.
Writes scores and feedback to a CSV.

Important implementation note: do not strip <em> tags, because the LLM needs them to judge highlight selection.

The extraction should preserve simplified HTML, for example:

It was a <em>blackout</em>, and the wind outside...

The API key should be stored as an environment variable:

export OPENAI_API_KEY="your_api_key_here"

or in a local .env file using python-dotenv.

Current rubric draft
1. Level fit

Evaluate whether the article fits the target CEFR level.

5 = very well suited to the target level
4 = mostly suited, with small issues
3 = understandable but somewhat too easy or too hard
2 = clearly too easy or too hard in several places
1 = unsuitable for the target level
2. Highlight selection

Evaluate whether the highlighted <em> words or phrases are well chosen for learning.

5 = highlights are highly useful, level-appropriate, and well selected
4 = mostly good highlights, with a few weak or missed choices
3 = mixed: some good highlights, but several are too basic, too hard, irrelevant, or missing
2 = many highlights are poorly chosen
1 = highlights are mostly unhelpful or missing

Important issue discovered: if an article has no highlighted words / no <em> tags, this may cause the evaluator to give a very low score. We need to decide whether “missing highlights” should be a separate flag rather than dragging down the whole article.

3. Engagement

Engagement was initially too vague and caused over-scoring.

Current definition:

Engagement evaluates how likely a language learner is to want to continue reading the article because of curiosity, emotion, practical urgency, narrative momentum, relatable people, or a concrete situation.

It should not simply mean “the article is useful.”

Current scoring draft:

5 = very engaging; strong curiosity, emotion, practical urgency, or narrative momentum
4 = engaging; clear story, relatable situation, practical usefulness, or interesting angle
3 = moderately engaging; readable and useful, but learners may continue mainly for vocabulary practice
2 = low engagement; polished but static, generic, abstract, or not very motivating
1 = not engaging; dull, repetitive, artificial, confusing, or unlikely to hold attention

Important refinement needed:

The LLM was overrating practical checklist/advice articles because it treated “useful” as “engaging.” We proposed this extra rule:

Engagement should not be rated high only because the article is useful or practical.

A practical checklist, safety guide, or advice article can score high only if it also has at least one of the following:
- a concrete human situation
- narrative progression
- emotional stakes that develop
- curiosity or tension
- a memorable example or scenario
- a strong reader-facing problem that creates urgency

If the article is mainly procedural advice with predictable steps, the maximum engagement score should usually be 3, even if the advice is useful.
4. Freshness

The user liked “freshness” because it measures whether the article feels different from typical learner content.

Freshness is separate from engagement.

Engagement = “Do I want to keep reading?”
Freshness = “Does this feel original, specific, and not like generic language-learning filler?”

Current definition:

Freshness evaluates whether the article feels original, specific, vivid, and non-generic compared with typical language-learning content.

Signals:

specific angle
vivid details
original or less predictable situation
non-obvious takeaway
natural complexity
avoids clichés and standard textbook situations
feels like real content adapted for learners, not text artificially written around vocabulary

Current scoring draft:

5 = very fresh; original, specific, memorable, and clearly above standard learner content
4 = fresh; contains specific or unexpected elements, though the structure may still be familiar
3 = moderately fresh; acceptable and clear, but the situation or ideas are fairly familiar
2 = not very fresh; generic, predictable, or formulaic despite being correct/useful
1 = not fresh at all; obvious filler, cliché, repetitive, or clearly written only to include target vocabulary

Important refinement needed:

The LLM also over-scored freshness for a clear, useful article. We proposed:

Freshness should not be rated high only because the article is clear, useful, or well organized.

If the article follows a standard advice format or gives predictable information for the topic, its freshness score should usually be 2 or 3.

To score 4 or 5, the article needs a distinctive angle, unusual scenario, vivid specific details, surprising example, or memorable takeaway that makes it feel different from standard learner content.
Example articles discussed
1. Emergency phone-use advice article

This was a general instructional text about using a phone during emergencies.

Reaction:

Useful and practical
Appropriate for B2
Good emergency vocabulary
But somewhat dense and instructional
Less memorable than a story

Likely engagement: moderate, maybe 3
Freshness: likely 2–3

2. Café blackout emergency story

Text summary:

A café worker is closing the café during a blackout. A coworker slips, hits her head, becomes unconscious, emergency services are called, paramedics arrive, and she later recovers.

Reaction:

Much more engaging than the instruction article
Clear story arc
Character, tension, danger, emotion, resolution
Useful vocabulary in context
Strong learner appeal

Suggested scores:

{
  "engagement": 4,
  "freshness": 4
}

Possibly engagement 5 depending on strictness.

Why high:

narrative pull
emotional stakes
concrete setting
vivid details
natural emergency vocabulary
satisfying resolution
3. Landscape / terrain descriptive article

Text summary:

A descriptive travel/geography article about mountain roads, ridges, plains, plateaus, gorges, canyons, ravines, valleys, and terrain.

Initial assistant rating was too generous on engagement. User challenged it.

Revised analysis:

Strong vocabulary
Strong category fit for geography/landscape
Beautiful writing
But static and descriptive
No character, no problem, no surprise, no narrative pull
Learners would likely continue only for vocabulary, not because they are curious

Suggested scores for B2:

{
  "level_fit": 3,
  "engagement": 2,
  "freshness": 2
}

Maybe freshness 3 if valuing vivid descriptive details, but not 4.

Key conclusion:

A text can be well written and vocabulary-rich but still low on engagement.

4. Reverso article: “Filing an Insurance Claim After a Crash”

URL:

https://www.reverso.net/reader/en/c300eb20-a007-436c-bd55-fef95b8012ff

The model rated it:

{
  "engagement": 4,
  "freshness": 4
}

The user did not understand why.

Analysis:

This article is a practical guide about what to do after a car crash: check safety, document the accident, exchange insurance details, contact insurer, review deductible/copay, keep receipts, respond to adjuster.

Diagnosis:

The model likely confused practical usefulness with engagement and freshness.

Better rating:

{
  "engagement": 2 or 3,
  "freshness": 2
}

Why:

Useful but mostly procedural
Predictable advice
No character or narrative
No surprising angle
No emotional development
Standard “what to do after X” article

Important rubric fix:

Practical value should not automatically raise engagement or freshness.

5. Reverso article: “Lunch Break at Jefferson High”

URL:

https://www.reverso.net/reader/en/cb0ca244-1005-4c8b-a676-88e5ccf7cfab#?oneClickMode=0

The user said it was rated very low.

Analysis:

This is a short school-life story about Maya, Jordan, lunch break, copying homework, pizza, a quiz, helping a sick classmate catch up, and a small moment of tension when the assistant principal enters.

Better rating:

{
  "level_fit": 4,
  "engagement": 3,
  "freshness": 3
}

assuming target level is B1/B2.

Why not very low:

Has characters
Relatable school setting
Some event progression
Small stakes
Concrete details

Why not high:

Familiar school scenario
Low emotional intensity
No major twist
Somewhat standard learner-content theme

Possible reason for very low model score:

The fetched page showed “Words 0” / no visible highlighted words, so the evaluator may have penalized highlight selection heavily.
If target level was C1, the text may have seemed too easy.
The current scoring system may be too harsh when there are no <em> tags.

Important issue to solve:

Missing or invisible highlights should perhaps be separated from article quality.

Current problem to solve with another LLM

The current rubric still needs improvement because scores are not aligned with the user’s expectations.

Main problems:

Engagement is over-scored for practical articles.
Example: insurance-claim guide got 4/5 but should be 2–3.
The model confuses usefulness with engagement.
Freshness is over-scored for clear, useful, well-organized articles.
Example: insurance article got 4/5 but should be 2.
The model confuses clarity/usefulness with originality.
Some story-based but simple articles may be under-scored.
Example: lunch break at school article rated very low, but should be around 3.
Low stakes should not mean bad; relatable human scenes deserve moderate engagement.
Highlight selection may distort overall judgment.
If <em> tags are missing, the article might be rated very low even if content is fine.
Need either a separate “highlight_missing” flag or scoring rule.
Need clearer calibration examples.
The evaluator should probably include anchor examples:
emergency café story = high engagement/freshness
landscape descriptive article = low engagement, low-to-mid freshness
insurance claim checklist = low-to-mid engagement, low freshness
school lunch story = moderate engagement/freshness
Desired scoring philosophy

The user does not want all “good educational texts” to score high.

A good article can be:

pedagogically useful
relevant
clear
level-appropriate

but still not wow content.

The most important distinction:

High engagement requires one or more of:
story arc
human stakes
emotional involvement
curiosity
tension
narrative momentum
strong practical urgency presented vividly
relatable scenario with progression
High freshness requires one or more of:
unusual angle
specific and memorable details
less predictable situation
avoids generic learner-text template
non-obvious takeaway
feels like real content, not vocabulary packaging
Practical usefulness alone should not create high scores.
Polish alone should not create high scores.
Vocabulary richness alone should not create high scores.
Current evaluator prompt draft
You are evaluating an English-learning article for language learners.

Target level: {{TARGET_LEVEL}}

Definition of a good article:
A good article is level-consistent, has useful and well-chosen highlights, keeps a learner reading without feeling dull, and feels original rather than generic.

Strict scoring policy:
- Do not reward clarity, correctness, or usefulness alone with high engagement or high freshness.
- When evidence is mixed, prefer conservative scoring (2-3).
- Scores of 4-5 require clear evidence.

Evaluate the article on the following criteria from 1 to 5.

1. Level fit
Does the article fit the target CEFR level?
Assess the whole text, not isolated sentences.
If CEFR demand is uneven (frequent jumps too easy/too hard), level_fit should usually not exceed 3.
5 = very well suited to the target level
4 = mostly suited, with small issues
3 = understandable but somewhat too easy or too hard
2 = clearly too easy or too hard in several places
1 = unsuitable for the target level

2. Highlight selection
Are the highlighted <em> words or phrases well chosen for learning?
If highlighted tags are missing or not visible, return highlight_selection as "NA" and set highlight_missing to true.
When highlights are missing, do not penalize level_fit, engagement, or freshness.
5 = highlights are highly useful, level-appropriate, and well selected
4 = mostly good highlights, with a few weak or missed choices
3 = mixed: some good highlights, but several are too basic, too hard, irrelevant, or missing
2 = many highlights are poorly chosen
1 = highlights are mostly unhelpful or missing

3. Engagement
Evaluate how likely a language learner is to want to continue reading the article.

Engagement is about reading motivation and attention.

Consider:
- Is there narrative pull, such as a situation, problem, event, or progression?
- Are there people, emotions, choices, stakes, or relatable experiences?
- Is there practical relevance to a real-life situation learners may care about?
- Does the article create curiosity, tension, surprise, or momentum?
- Does the pacing move forward, or is it mostly static?

Important:
Engagement should not be rated high only because the article is useful or practical.
High engagement does not require novel-like tension. It can come from relatable real-life context, concrete situations, clear progression, or vivid practical urgency.
A practical checklist, safety guide, or advice article can score high only if it also has a concrete human situation, narrative progression, emotional stakes, curiosity, tension, a memorable example, or a strong reader-facing problem that creates urgency.
If the article is mainly procedural advice with predictable steps, the maximum engagement score should usually be 3, even if the advice is useful.

Scoring:
5 = very engaging; strong curiosity, emotion, practical urgency, or narrative momentum
4 = engaging; clear story, relatable situation, practical usefulness, or interesting angle
3 = moderately engaging; readable and useful, but learners may continue mainly for vocabulary practice
2 = low engagement; polished but static, generic, abstract, or not very motivating
1 = not engaging; dull, repetitive, artificial, confusing, or unlikely to hold attention

4. Freshness
Evaluate whether the article feels original, specific, and non-generic compared with typical language-learning content.

Freshness is NOT the same as engagement.
- Engagement asks whether a learner wants to keep reading.
- Freshness asks whether the article avoids feeling predictable, generic, cliché, or template-like.

Consider:
- Does the article have a specific angle rather than a generic overview?
- Are there vivid details that feel intentionally chosen?
- Is the situation, example, or takeaway at least slightly unexpected?
- Does the article feel like real content adapted for learners, rather than text artificially written around vocabulary?
- Does it avoid obvious textbook-style situations, clichés, and filler sentences?

Important:
Freshness should not be rated high only because the article is clear, useful, or well organized.
If the article follows a standard advice format or gives predictable information for the topic, its freshness score should usually be 2 or 3.
To score 4 or 5, the article needs a distinctive angle, unusual scenario, vivid specific details, surprising example, or memorable takeaway that makes it feel different from standard learner content.

Scoring:
5 = very fresh; original, specific, memorable, and clearly above standard learner content
4 = fresh; contains specific or unexpected elements, though the structure may still be familiar
3 = moderately fresh; acceptable and clear, but the situation or ideas are fairly familiar
2 = not very fresh; generic, predictable, or formulaic despite being correct/useful
1 = not fresh at all; obvious filler, cliché, repetitive, or clearly written only to include target vocabulary

Return only valid JSON in this format:

{
  "scores": {
    "level_fit": 1,
    "highlight_selection": 1,
    "engagement": 1,
    "freshness": 1
  },
  "highlight_missing": false,
  "freshness_reason": "",
  "engagement_reason": "",
  "strengths": [],
  "issues": []
}

Output constraints:
- "engagement_reason" and "freshness_reason" must be very short (one short sentence each).
- Keep "strengths" and "issues" concise (max 3 items each, short phrases).
- "highlight_selection" must be either an integer 1-5 or "NA" when highlights are missing/not visible.

Article HTML:
{{ARTICLE_HTML}}