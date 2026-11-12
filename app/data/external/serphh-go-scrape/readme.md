# GATE Overflow scrape (community dataset)
Source: https://github.com/TheSerphh/Extract-Gate-CSE-Questions (files: question_details(pdf).json, questions_details.json, readme.md). Fetched 2026-10-06.
Content: 4303 question pages scraped from https://gateoverflow.in (GATE CSE 1987-2025 sets, GATE IT 2004-08, some other exams): link, title, votes, tags (topic + difficulty), question_html, answers_html, correct_option (GO accepted answer, a community answer, not an official key).
License: repo has no license; underlying content is user-contributed on GATE Overflow (gateoverflow.in terms apply). Personal study use only; do not redistribute. gateoverflow.in itself blocks bots (Cloudflare).
Note: file has raw control chars; load with json.loads(..., strict=False).
