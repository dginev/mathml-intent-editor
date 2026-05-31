import {
  changeSummary,
  effectiveYaml,
  formatChangeSummary,
  markdownChangeSummary,
  prTitle,
  type BaseMap,
} from '../data/pendingChanges';
import { newBranchName } from './prSession';
import type { Concept } from '../types';

/** Everything a Save sends to the service, derived purely from the working set + session. */
export type Submission = {
  content: string;
  message: string;
  title: string;
  description: string;
  branch: string;
};

/**
 * Assemble a Save submission from the current working set: the file content, a terse commit `message`,
 * an auto PR `title`, the Markdown `description` (the user's text, or the generated summary if blank),
 * and the target `branch` — reusing the open PR's branch, or minting a fresh unique one. Pure (takes
 * `now`) so the branch/payload logic is unit-testable.
 */
export function buildSubmission(args: {
  concepts: readonly Concept[];
  deletedIds: ReadonlySet<string>;
  baseMap: BaseMap;
  handle: string;
  activeBranch: string | null;
  description: string;
  now: Date;
}): Submission {
  const { concepts, deletedIds, baseMap, handle, activeBranch, description, now } = args;
  const summary = changeSummary(concepts, deletedIds, baseMap);
  const firstConcept = [...summary.added, ...summary.modified, ...summary.deleted].sort()[0] ?? 'update';
  return {
    content: effectiveYaml(concepts, deletedIds),
    message: formatChangeSummary(summary) || `Update open.yml (proposed by @${handle})`,
    title: prTitle(summary, handle),
    description: description.trim() || markdownChangeSummary(summary),
    branch: activeBranch ?? newBranchName(handle, firstConcept, now),
  };
}
