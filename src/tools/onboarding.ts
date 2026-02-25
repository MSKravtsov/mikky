import { registerTool } from "./index.js";
import { db } from "../db.js";

// ─── Onboarding questionnaire (inspired by Mem, Notion AI, Reflect) ──
// Structured in sections, asked conversationally one at a time.

const ONBOARDING_SECTIONS = [
    {
        section: "Identity",
        questions: [
            { key: "name", question: "What's your full name?" },
            {
                key: "role",
                question:
                    "What's your current role/title? (e.g. Senior Data Engineer, CTO, Freelance Consultant)",
            },
            { key: "company", question: "What company or organization do you work for?" },
            { key: "industry", question: "What industry are you in?" },
            { key: "location", question: "Where are you based? (city/country)" },
        ],
    },
    {
        section: "Expertise & Skills",
        questions: [
            {
                key: "expertise",
                question:
                    "What are your top 3-5 areas of expertise? (e.g. cloud architecture, machine learning, data pipelines)",
            },
            {
                key: "tech_stack",
                question:
                    "What technologies/tools do you use daily? (e.g. Python, AWS, Terraform, Kubernetes)",
            },
            {
                key: "certifications",
                question:
                    "Any notable certifications, degrees, or credentials? (skip if none)",
            },
        ],
    },
    {
        section: "Content & LinkedIn Goals",
        questions: [
            {
                key: "linkedin_goal",
                question:
                    "What's your goal with LinkedIn? (e.g. thought leadership, hiring, networking, personal brand, lead generation)",
            },
            {
                key: "target_audience",
                question:
                    "Who is your target audience on LinkedIn? (e.g. engineers, CTOs, recruiters, startup founders)",
            },
            {
                key: "content_topics",
                question:
                    "What topics do you want to post about? (e.g. AI trends, career advice, technical deep-dives, industry insights)",
            },
            {
                key: "content_avoid",
                question:
                    "Anything you want to AVOID posting about? (e.g. politics, specific competitors, personal life)",
            },
        ],
    },
    {
        section: "Communication Style",
        questions: [
            {
                key: "tone",
                question:
                    "How would you describe your preferred tone? (e.g. professional but approachable, casual and witty, formal and authoritative, storytelling-focused)",
            },
            {
                key: "writing_style",
                question:
                    "Do you prefer short punchy posts or longer narrative ones? Bullet points or flowing paragraphs? Emojis or no emojis?",
            },
            {
                key: "language",
                question:
                    "What language(s) should posts be in? (e.g. English only, English and German, etc.)",
            },
        ],
    },
    {
        section: "Personal Touch",
        questions: [
            {
                key: "unique_perspective",
                question:
                    "What makes your perspective unique? What do you bring that others in your field don't?",
            },
            {
                key: "values",
                question:
                    "What professional values or principles matter most to you? (e.g. open source, data privacy, mentorship, innovation)",
            },
            {
                key: "fun_fact",
                question:
                    "Any fun fact or personal detail you'd like woven into your professional brand? (e.g. hobby, side project, unusual background)",
            },
        ],
    },
];

// ─── Tool: start_onboarding ──────────────────────────────────────────
registerTool({
    name: "start_onboarding",
    description:
        "Start or continue the user onboarding questionnaire to build their profile. Call this when the user wants to set up their profile, or when the profile is empty. Returns the next unanswered question. Ask questions ONE AT A TIME in a conversational way.",
    inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
    },
    async execute(): Promise<string> {
        // Check which profile keys are already filled
        const existingKeys = db
            .prepare("SELECT key FROM profile")
            .all() as Array<{ key: string }>;

        const filledKeys = new Set(existingKeys.map((r) => r.key));

        // Find remaining questions
        const remaining: Array<{
            section: string;
            key: string;
            question: string;
        }> = [];

        for (const section of ONBOARDING_SECTIONS) {
            for (const q of section.questions) {
                if (!filledKeys.has(q.key)) {
                    remaining.push({ section: section.section, ...q });
                }
            }
        }

        if (remaining.length === 0) {
            // All questions answered — return full profile
            const profile = db
                .prepare("SELECT key, value FROM profile ORDER BY key")
                .all() as Array<{ key: string; value: string }>;

            return JSON.stringify({
                complete: true,
                message:
                    "Profile is complete! All questions have been answered.",
                profile: Object.fromEntries(profile.map((r) => [r.key, r.value])),
            });
        }

        const totalQuestions = ONBOARDING_SECTIONS.reduce(
            (sum, s) => sum + s.questions.length,
            0
        );
        const answered = totalQuestions - remaining.length;
        const next = remaining[0]!;

        return JSON.stringify({
            complete: false,
            progress: `${answered}/${totalQuestions}`,
            current_section: next.section,
            profile_key: next.key,
            question: next.question,
            remaining_count: remaining.length,
            instruction:
                "Ask this question conversationally. After the user answers, save it with set_profile using the profile_key, then call start_onboarding again for the next question. Let the user skip questions if they want.",
        });
    },
});

// ─── Tool: get_onboarding_progress ───────────────────────────────────
registerTool({
    name: "get_onboarding_progress",
    description:
        "Check how much of the onboarding questionnaire has been completed.",
    inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
    },
    async execute(): Promise<string> {
        const existingKeys = db
            .prepare("SELECT key FROM profile")
            .all() as Array<{ key: string }>;

        const filledKeys = new Set(existingKeys.map((r) => r.key));

        const totalQuestions = ONBOARDING_SECTIONS.reduce(
            (sum, s) => sum + s.questions.length,
            0
        );

        const sections = ONBOARDING_SECTIONS.map((s) => ({
            section: s.section,
            completed: s.questions.filter((q) => filledKeys.has(q.key)).length,
            total: s.questions.length,
            missing: s.questions
                .filter((q) => !filledKeys.has(q.key))
                .map((q) => q.key),
        }));

        const answered = totalQuestions - sections.reduce((s, sec) => s + sec.missing.length, 0);

        return JSON.stringify({
            progress: `${answered}/${totalQuestions}`,
            complete: answered === totalQuestions,
            sections,
        });
    },
});
