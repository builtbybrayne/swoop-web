// -----------------------------------------------------------------------------
// find_someone_who tool I/O fixtures (Mirror, conditional on C.26).
//
// Visitor moment: a persona signal lands — "I'm going alone, mid-40s, post-
// divorce". The tool answers "yes, people like you have done this".
// -----------------------------------------------------------------------------

import type {
  FindSomeoneWhoInput,
  FindSomeoneWhoOutput,
} from "../tools.js";

import { SampleCustomerStoryPublic } from "./customer-story.sample.js";

export const SampleFindSomeoneWhoInput: FindSomeoneWhoInput = {
  signal: "solo woman in my mid-40s, first big trip after a divorce",
  region: "torres-del-paine",
  limit: 3,
};

export const SampleFindSomeoneWhoOutput: FindSomeoneWhoOutput = {
  stories: [SampleCustomerStoryPublic],
  count: 1,
};
