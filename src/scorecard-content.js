// Tool 1 of Javed Sajad's DMS Nonprofit Safe AI Toolkit, as adapted for the
// DMS webinar scorecard (dms-webinar/server/src/readiness-content.js).
// Statements, scale, score bands and management actions follow the source and
// must stay word for word. The short actions and the critical-gap mapping are
// the web report's interpretation, not source text.
export const SCALE = [
  { value: 0, label: 'No / unknown', detail: 'We do not have this in place, or we are not sure.' },
  { value: 1, label: 'Partly / inconsistent', detail: 'Some of this is in place, but it is not consistent.' },
  { value: 2, label: 'Yes / documented and working', detail: 'We have evidence that this is in place and working.' },
];

const question = (id, statement, action, critical = null) => ({ id, statement, action, critical });
export const DOMAINS = [
  {
    id: 'visibility', letter: 'A', title: 'Visibility and ownership',
    questions: [
      question(1, 'We maintain an inventory of AI-enabled tools and material staff uses.', 'List the AI tools staff use, what they use them for, and who is responsible for each use.'),
      question(2, 'Each approved use has a named business owner, not only a technical contact.', 'Name a business owner for each approved use.'),
      question(3, 'Staff know which tools are approved and where to report an unapproved or unsafe use.', 'Share the list of approved tools and tell staff where to report unapproved or unsafe use.', 'Approved tools and reporting unsafe use'),
      question(4, 'Leadership receives a periodic view of current uses, incidents, exceptions and changes.', 'Schedule regular updates for leadership on AI uses, incidents, exceptions and changes.'),
    ],
  },
  {
    id: 'purpose', letter: 'B', title: 'Purpose and value',
    questions: [
      question(5, 'The workflow problem is repeated, costly, delayed, error-prone or burdensome enough to justify change.', 'Identify the cost, delays, errors or extra work that the tool would address.'),
      question(6, 'We have a baseline for time, cost, quality, error or service impact before implementation.', 'Measure the current workflow before changing it.'),
      question(7, 'We have defined what the tool may prepare, recommend or decide - and what it must not do.', 'Write down what the tool may do and which decisions must stay with a person.', 'Limits on what the tool can do'),
      question(8, 'We know how saved time or improved quality will strengthen mission delivery or staff work.', 'Explain how the expected improvement will help staff or the people you serve.'),
    ],
  },
  {
    id: 'data', letter: 'C', title: 'Data and vendor',
    questions: [
      question(9, 'Information is classified before it enters a tool: public, internal, sensitive or regulated.', 'Classify information before putting it into a tool.', 'Classifying information before use'),
      question(10, 'Vendor terms address use of prompts/data, retention, model training, deletion and subprocessors.', 'Get written vendor terms for data use, retention, training, deletion and subprocessors.', 'Vendor terms for data use and retention'),
      question(11, 'Security, access, incident reporting and business-continuity responsibilities are documented.', 'Document who handles security, access, incident reporting and business continuity.', 'Security, access and incident responsibilities'),
      question(12, 'We can retrieve, correct, preserve and delete information when our duties require it.', 'Test how you retrieve, correct, preserve and delete information.', 'Retrieving, correcting, preserving and deleting information'),
    ],
  },
  {
    id: 'human', letter: 'D', title: 'Human responsibility and affected people',
    questions: [
      question(13, 'A named person has the knowledge and time to review the result.', 'Name a qualified reviewer and give them time to review results.', 'A reviewer with the knowledge and time to check results'),
      question(14, 'That person can see the evidence, reject the result and escalate uncertainty.', 'Give the reviewer access to evidence and authority to reject or escalate results.', 'A reviewer who can check evidence, reject results and escalate concerns'),
      question(15, 'People affected by a significant decision can reach a human and seek correction or review.', 'Provide a way for affected people to reach a human and ask for review.', 'Human review for people affected by a decision'),
      question(16, 'The organisation records who approved the use and who owns the final decision.', 'Record who approves each use and who is accountable for the final decision.', 'Responsibility for approval and final decisions'),
    ],
  },
  {
    id: 'implementation', letter: 'E', title: 'Implementation and people',
    questions: [
      question(17, 'An executive sponsor can resource, defend, change or stop the use.', 'Name an executive sponsor who can provide resources and change or stop the use.', 'An executive sponsor with authority to change or stop the use'),
      question(18, 'Staff receive role-specific training before using the workflow.', 'Train staff for their role before they use the workflow.'),
      question(19, 'The pilot is narrow, reversible, time-bound and includes a stopping rule.', 'Set the pilot’s scope, end date and stopping conditions, and plan how to reverse it.', 'Pilot scope, end date and stopping conditions'),
      question(20, 'We review performance, errors, complaints, vendor changes and workforce effects after launch.', 'Schedule reviews of performance, errors, complaints, vendor changes and effects on staff.', 'Monitoring after launch'),
    ],
  },
];

export const BANDS = [
  { min: 0, max: 10, name: 'Unmapped', action: 'Pause sensitive or consequential use; inventory tools, purposes, data and owners.' },
  { min: 11, max: 20, name: 'Experimental', action: 'Set approved tools and data boundaries; name a sponsor; choose one controlled use.' },
  { min: 21, max: 30, name: 'Controlled', action: 'Complete vendor review, training, measures and evidence for a narrow pilot.' },
  { min: 31, max: 40, name: 'Governed', action: 'Monitor performance and change; review incidents, vendors and board reporting.' },
];

export const CONVERSATION = [
  { id: 'workflow', label: 'Which workflow should we test first?' },
  { id: 'information', label: 'What information is involved?' },
  { id: 'affected', label: 'Who is affected if it is wrong?' },
  { id: 'sponsor', label: 'Who is the executive sponsor?' },
  { id: 'human', label: 'What must remain a human decision?' },
  { id: 'evidence', label: 'What evidence is missing?' },
  { id: 'date', label: 'Decision date', type: 'date' },
];

// Shared by the scorecard page, the staff view and exported reports.
export const FEEDBACK = {
  gaps: 'These items scored 0. Address them before using AI for work that depends on them.',
  noGaps: 'No critical items were marked “No / unknown.”',
  followUp: 'Set a date to review this scorecard with your team.',
};
export const DEFINITION = { version: 1, domains: DOMAINS, scale: SCALE, bands: BANDS, conversation: CONVERSATION, feedback: FEEDBACK };

function invalid(message) {
  return Object.assign(new Error(message), { status: 400 });
}

export function validateAssessment(input) {
  if (!input || !Array.isArray(input.answers) || input.answers.length !== 20 ||
      !input.answers.every((value) => Number.isInteger(value) && value >= 0 && value <= 2)) {
    throw invalid('Answer all 20 statements with 0, 1 or 2 before getting your score.');
  }
  if (typeof input.submissionId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.submissionId)) {
    throw invalid('The report reference is missing. Refresh the page and try again.');
  }
  const readText = (value, max) => {
    if (value === undefined) return '';
    if (typeof value !== 'string' || value.length > max) throw invalid(`Use ${max} characters or fewer for each note.`);
    return value.trim();
  };
  const notes = Object.fromEntries(DOMAINS.map((d) => [d.id, readText(input.notes?.[d.id], 600)]));
  const conversation = Object.fromEntries(CONVERSATION.map((q) => [q.id, readText(input.conversation?.[q.id], q.type === 'date' ? 10 : 400)]));
  if (conversation.date && (!/^\d{4}-\d{2}-\d{2}$/.test(conversation.date) ||
      !Number.isFinite(Date.parse(conversation.date)) || new Date(conversation.date).toISOString().slice(0, 10) !== conversation.date)) {
    throw invalid('Enter a valid decision date.');
  }
  return { submissionId: input.submissionId, answers: [...input.answers], notes, conversation };
}

export function scoreAssessment(answers) {
  const domains = DOMAINS.map((domain) => ({ id: domain.id, title: domain.title,
    score: domain.questions.reduce((sum, q) => sum + answers[q.id - 1], 0), max: 8 }));
  const total = domains.reduce((sum, d) => sum + d.score, 0);
  const band = BANDS.find((b) => total <= b.max);
  const questions = DOMAINS.flatMap((d) => d.questions);
  const criticalGaps = questions.filter((q) => q.critical && answers[q.id - 1] === 0)
    .map((q) => ({ id: q.id, statement: q.statement, reason: q.critical, action: q.action }));
  const priorities = questions.filter((q) => answers[q.id - 1] < 2)
    .sort((a, b) => Number(Boolean(b.critical) && answers[b.id - 1] === 0) - Number(Boolean(a.critical) && answers[a.id - 1] === 0) || answers[a.id - 1] - answers[b.id - 1] || a.id - b.id)
    .slice(0, 3).map((q) => ({ id: q.id, action: q.action, score: answers[q.id - 1] }));
  return { total, max: 40, band, domains, criticalGaps, priorities };
}
