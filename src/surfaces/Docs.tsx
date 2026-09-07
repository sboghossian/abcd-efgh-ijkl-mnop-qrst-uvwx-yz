import "./Docs.css";
import { useStore } from "../lib/store";

interface DocTopic {
  id: string;
  label: string;
  title: string;
  paragraphs: string[];
}

const TOPICS: DocTopic[] = [
  {
    id: "start",
    label: "What abcd is",
    title: "What abcd is",
    paragraphs: [
      "abcd is your own harness, not a hosted product. It runs on your machine and reaches into the sessions you already run. It does not replace Claude Code or Codex; it sits on top of them and gives you one place to see everything that is currently going on.",
      "Most work already happens across a scattering of terminal tabs, editor windows, and one-off browser sessions. abcd treats each of those as a session, and a session is just one tab inside your system, so you keep working the way you already do. abcd is the surface that makes all of them visible together.",
      "Getting a session under abcd's control takes two clicks: point it at a running session, then confirm. From there it can be started, watched, or nudged from any surface in the app, without you needing to remember where you left it.",
      "None of this needs a new mental model. abcd is a control tower over the sessions you would be running anyway, not another chat window competing for your attention.",
    ],
  },
  {
    id: "groups",
    label: "Groups",
    title: "Groups",
    paragraphs: [
      "A group binds to a primary filesystem root, plus any extra roots a real theme needs. A single feature rarely lives in one repository, so a group can span several: a frontend, a backend, a couple of worktrees, all treated as one place.",
      "Sessions are grouped automatically, based on where they run. abcd looks at a session's working directory and matches it against each group's roots. Most of the time this gets it right without you doing anything.",
      "When it does not, every assignment is undoable with one gesture. Pull a session out of the wrong group and it moves immediately, no confirmation dialog needed. Automatic grouping is a guess, and your correction is the answer.",
      "Undo also pins the session to the group you chose. A pinned session stays put: the same re-inference that grouped it wrong the first time will never look at that session again and move it back. You only correct a mistake once.",
    ],
  },
  {
    id: "sessions",
    label: "Sessions",
    title: "Sessions",
    paragraphs: [
      "A session is one running instance of an AI coding agent, Claude Code, Codex, or anything else abcd can see, working inside one directory. It carries a model, a working directory, a git branch if there is one, and a running total of tokens and estimated cost.",
      "Every session's status, working, needs input, idle, completed, failed, is derived, not set by hand. abcd reads it off the session's own transcript and process state. There is no button anywhere that flips a session to done. If a status looks wrong, the session is telling you something wrong, not abcd.",
      "abcd distinguishes three tiers of reach into a session. Tier 1 is a session abcd itself started: full control, it can send prompts and watch every turn. Tier 2 is a session started somewhere else, a terminal or an editor, that abcd can still reach: it can usually watch and send, but it did not create the process. Tier 3 is a session abcd can only see, not touch: read-only, watch only, no sending.",
      "The tier is not a judgment about a session's importance. It is a statement about how much abcd is allowed to do to it. A tier 3 session is exactly as real as a tier 1 one; abcd simply reached it a different way.",
    ],
  },
  {
    id: "prompt",
    label: "The prompt box",
    title: "The prompt box",
    paragraphs: [
      "There is one prompt box in abcd, not one per session. Type into it and, by default, it goes to whichever session you last activated, the one currently in focus.",
      "Type @ to tag a different session by name and send to it instead, without leaving the box or hunting through tabs. abcd resolves the tag to a specific session and shows you which one you are about to address before you send.",
      "Leave the target empty to broadcast. The same prompt goes to every reachable session at once, useful for anything every agent should know: a change of direction, a new constraint, a reminder about a shared file.",
      "Sessions abcd cannot reach, tier 3, cannot receive anything from the prompt box. abcd tells you this up front rather than pretending to send. A broadcast simply skips them, and the box shows you which sessions were left out.",
    ],
  },
  {
    id: "day",
    label: "The day",
    title: "The day",
    paragraphs: [
      "abcd frames a day as one arc, not a pile of unrelated tabs. Opening the app asks you to set one objective, a sentence describing what today is actually for, and keeps it visible in the top bar so every surface stays anchored to it.",
      "As the day goes on and sessions sit idle, the interface softens around them, dimming what is not asking for anything so whatever needs you stands out. Nothing is hidden; it just recedes.",
      "Winding down asks every reachable session to checkpoint itself, save its state, summarize where it stands, before you step away. This is cooperative, not enforced. abcd has no way to forcibly pause a running agent mid task; there is no pause primitive in the underlying tools, so it asks, and each session decides how to respond.",
      "Closing reconciles the day. It compares what actually happened against the objective you set that morning and records the gap honestly, rather than marking the day complete regardless.",
    ],
  },
  {
    id: "brain",
    label: "Brain",
    title: "Brain",
    paragraphs: [
      "The lobe view is a curated slice of your vault: the notes and connections abcd thinks are relevant to what you are working on right now. It exists so you are not paging through years of unrelated notes to find the one that matters this afternoon.",
      "The full vault is everything, unfiltered. You can drop into it any time the lobe view is too narrow, or when you are looking for something abcd had no reason to surface.",
      "Backlinks, which notes point at which, are not computed live. They come from a footer abcd pre-computes and writes into each note ahead of time. This keeps the brain view fast even against a large vault, at the cost of a link occasionally lagging behind a note you just edited by a few minutes.",
    ],
  },
  {
    id: "cost",
    label: "Cost",
    title: "Cost",
    paragraphs: [
      "Token counts in abcd are measured. They come directly off each session's usage numbers: input, output, cache read, cache write. They are exact.",
      "The dollar figure next to them is not. It is estimated by applying a public price table for the model in use to those token counts. abcd has no visibility into your actual bill, and on a subscription plan there usually is not a per-token bill to see in the first place.",
      "Treat the dollar number as a useful proxy for relative cost, this session cost more than that one, not as an invoice. For real spend, check your provider's own billing page.",
    ],
  },
  {
    id: "privacy",
    label: "Privacy",
    title: "Privacy",
    paragraphs: [
      "abcd is local-first. Your sessions, your files, your vault all stay on your machine. Nothing about your prompts or your code has to leave it for the app to work.",
      "Incognito sessions write nothing back: no vault notes, no memory, no audit log entry. Turn it on for a session and abcd behaves as though it never saw it. Once the session ends, there is no trace inside abcd that it happened.",
      "abcd keeps a local audit log of what it did on your behalf: files touched, commands run, prompts sent. It stays on disk, it is never uploaded anywhere, and incognito sessions never appear in it.",
      "Demo mode swaps every real data source for fabricated fixtures: fake session names, fake paths, fake numbers, shaped like a working setup so you can take a screenshot or record a screen share without exposing anything real.",
    ],
  },
];

export function Docs() {
  const { ui, dispatch } = useStore();
  const active = TOPICS.find((t) => t.id === ui.docsTopic) ?? TOPICS[0];

  return (
    <div className="docs surface-pad">
      <div className="docs-head">
        <span className="eyebrow">Documentation</span>
      </div>
      <div className="docs-layout">
        <nav className="docs-nav" aria-label="Documentation topics">
          {TOPICS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`docs-nav-item${active?.id === t.id ? " on" : ""}`}
              aria-current={active?.id === t.id ? "page" : undefined}
              onClick={() => dispatch({ type: "docsTopic", topic: t.id })}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <article className="docs-content">
          {active && (
            <>
              <h2 className="docs-title">{active.title}</h2>
              {active.paragraphs.map((p, i) => (
                <p key={i} className="docs-para">{p}</p>
              ))}
            </>
          )}
        </article>
      </div>
    </div>
  );
}
