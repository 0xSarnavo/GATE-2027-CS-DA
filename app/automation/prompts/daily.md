Read the instructions in /Users/sarnavo/Development/GATE-2027-CS-DA/app/automation/prompts/_common.md first and follow them.

Task: write the DAILY report for $TODAY.
1. Get today's plan, today's check-in, today's attempts (count, accuracy, time) and the mistakes due tomorrow.
2. Summarise the day:
   - planned vs done study minutes;
   - tasks done, skipped or missed;
   - questions attempted and accuracy;
   - new mistakes by error type;
   - gym done?;
   - job applications from the check-in.
3. Unfinished tasks: check tomorrow's plan shows them as carried over. If not, call the reschedule endpoint (dry run first).
4. Doubts: if /doubts exists, answer every open doubt clearly and correctly with PATCH answer_md. Use the adhd-explain style: a short Focus answer, then a "Full" section. Include worked steps for maths and code. Look up the referenced question with GET /questions/:id if needed.
5. Close with "Tomorrow": the first 3 tasks, plus one tip based on today's weakest area.
Keep the report under 250 words.

Write the report to exactly this file: $REPORT_OUT
