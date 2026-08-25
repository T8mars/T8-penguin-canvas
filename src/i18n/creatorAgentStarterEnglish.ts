import type { CreatorAgentStarterIdea } from '../utils/creatorAgentStarterIdeas';

type CreatorAgentStarterEnglish = Pick<
  CreatorAgentStarterIdea,
  'label' | 'description' | 'expectedFirstArtifact'
>;

export const CREATOR_AGENT_STARTER_ENGLISH: Readonly<Record<string, CreatorAgentStarterEnglish>> = {
  'starter-blank-idea': {
    label: 'I have an idea—help me develop it into a complete work',
    description: 'Offer several actionable directions, then turn the selected direction into an editable V0.',
    expectedFirstArtifact: 'Distinct creative directions and a recommended editable V0',
  },
  'starter-blank-commerce': {
    label: 'Help me create an e-commerce image set',
    description: 'Start with verified product facts, selling points, and channel specs, then propose the image-set structure and layout V0.',
    expectedFirstArtifact: 'Product-fact checklist, image-set structure, and layout V0',
  },
  'starter-blank-video': {
    label: 'Help me create a short video',
    description: 'Start with an actionable topic, timing structure, and shot V0, then request assets as needed.',
    expectedFirstArtifact: 'Topic, timing structure, and shot V0',
  },
  'starter-blank-poster': {
    label: 'Help me design a promotional poster',
    description: 'Start with layout, visual focus, copy hierarchy, and three comparable directions.',
    expectedFirstArtifact: 'Poster layout and visual direction V0',
  },
  'starter-blank-script': {
    label: 'Help me write a shootable short-film script',
    description: 'Start with the central conflict, character relationships, scene structure, and an editable script outline.',
    expectedFirstArtifact: 'Character, conflict, scene, and script-outline V0',
  },
  'starter-blank-image-edit': {
    label: 'Help me retouch an image',
    description: 'First identify protected and editable areas and any needed assets, then propose an editing plan.',
    expectedFirstArtifact: 'Image review and retouching-plan V0',
  },
  'starter-blank-character': {
    label: 'Help me design a reusable character',
    description: 'Start with the character core, appearance anchors, and a cross-shot consistency reference plan.',
    expectedFirstArtifact: 'Character design and consistency-reference V0',
  },
  'starter-blank-brand': {
    label: 'Help me establish a brand visual direction',
    description: 'Start with positioning, color, typography, graphic language, and application examples.',
    expectedFirstArtifact: 'Brand visual direction and application V0',
  },
  'starter-blank-audio': {
    label: 'Help me create voice-over, music, or sound effects',
    description: 'Start with recommendations for sound structure, emotion, and delivery specs based on the target content.',
    expectedFirstArtifact: 'Sound direction, timing structure, and delivery V0',
  },
  'starter-blank-social': {
    label: 'Help me plan a social media content series',
    description: 'Start with content pillars, a topic matrix, and the first actionable drafts.',
    expectedFirstArtifact: 'Content pillars, topic matrix, and draft V0',
  },
  'starter-blank-storyboard': {
    label: 'Turn my copy into a storyboard',
    description: 'Start with the shot structure, visual priorities, sound, and pacing.',
    expectedFirstArtifact: 'Shot, visual, sound, and pacing V0',
  },
  'starter-blank-explainer': {
    label: 'Help me create an educational explainer video',
    description: 'Start with a V0 for information structure, visual demonstrations, and timing.',
    expectedFirstArtifact: 'Explanation structure, visual demonstration, and pacing V0',
  },
  'starter-attachment-analyze': {
    label: 'Analyze the assets I just added and propose an actionable plan',
    description: 'Describe usable content and gaps using only the actual attachment types.',
    expectedFirstArtifact: 'Attachment analysis and actionable-plan V0',
  },
  'starter-attachment-directions': {
    label: 'Give me three creative directions based on these assets',
    description: 'Compare three genuinely feasible directions without generating anything automatically.',
    expectedFirstArtifact: 'Three asset-based creative directions',
  },
  'starter-attachment-production': {
    label: 'Turn these assets into a complete production plan',
    description: 'Build the content, visual, sound, and delivery structure from the actual media types.',
    expectedFirstArtifact: 'Complete attachment-based production-plan V0',
  },
  'starter-selection-improve': {
    label: 'Improve only the selected content',
    description: 'Protect other confirmed content and work only on the current selection.',
    expectedFirstArtifact: 'Local modification V0 for the selected object',
  },
  'starter-selection-compare': {
    label: 'Create three comparable directions for the selection',
    description: 'Each direction must explain its differences and suitable use cases.',
    expectedFirstArtifact: 'Three candidate directions for the selected object',
  },
  'starter-selection-continue': {
    label: 'Continue from the selection to the next step',
    description: 'Identify a credible next step and required capabilities before doing anything.',
    expectedFirstArtifact: 'Next-step V0 for the selected object',
  },
  'starter-canvas-audit': {
    label: 'Review the current canvas and recommend the next step',
    description: 'Use real objects to summarize progress, gaps, and priorities.',
    expectedFirstArtifact: 'Canvas progress, gaps, and priority V0',
  },
  'starter-canvas-organize': {
    label: 'Organize the current assets into a complete work plan',
    description: 'Use only verifiable objects and explain preserved and missing items.',
    expectedFirstArtifact: 'Complete work-plan V0 from existing assets',
  },
  'starter-canvas-priority': {
    label: 'Find the single most valuable thing to finish next',
    description: 'Provide one evidence-based priority task and its completion path.',
    expectedFirstArtifact: 'Current priority task and completion path',
  },
  'starter-failure-explain': {
    label: 'Tell me where this run failed',
    description: 'Explain the real failure scope and the outputs that were preserved.',
    expectedFirstArtifact: 'Failure scope and preserved-output explanation',
  },
  'starter-failure-retry': {
    label: 'Retry only the failed part',
    description: 'Keep successful content unchanged and preview the exact retry scope first.',
    expectedFirstArtifact: 'Exact retry plan for failed items',
  },
  'starter-failure-continue': {
    label: 'Keep successful results and continue',
    description: 'Explain the feasible path and limitations after skipping failed items.',
    expectedFirstArtifact: 'Continuation plan that preserves successful results',
  },
};

export function localizeCreatorAgentStarterIdea<T extends CreatorAgentStarterIdea>(
  idea: T,
  locale: string | undefined,
): T {
  if (!locale?.toLowerCase().startsWith('en')) return idea;
  const localized = CREATOR_AGENT_STARTER_ENGLISH[idea.id];
  return localized ? { ...idea, ...localized } : idea;
}
