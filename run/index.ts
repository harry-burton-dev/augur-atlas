// Data Atlas's scenarios for AUGUR's run suite (the augur-run repository, AUGUR's ADR 0050): what a person
// does with the app in the proving run, and what shows it worked. The suite reads `scenarios` from here.
// Give each one the next free RUN id from augur-run's traceability.md, add its row there, and mark it
// `ready` once the suite can drive it.

export interface AppScenario {
  /** `RUN-<nn>`, from augur-run's traceability.md. */
  id: string;
  title: string;
  /** The alpha goal it proves. */
  goal: string;
  /** `waiting` until the steps can be driven. */
  status: 'ready' | 'waiting';
  /** What the person does, in order. */
  steps: string[];
  /** What the run records as evidence that it worked. */
  proof: string;
}

export const scenarios: AppScenario[] = [
  {
    // RUN-20 was the SDK 2 app's "what points at it"; the new app answers it from the knowledge graph.
    id: 'RUN-20',
    title: 'A thing the seed knows about is found by name in Data Atlas and opens on its page',
    goal: 'A person finds what they need and reads the truth as it is now (Data Atlas, PDR-002)',
    // Waiting for the AUGUR release in which the knowledge graph answers apps (`knowledge:read`).
    status: 'waiting',
    steps: [
      'Sign in as a person whose team floor the seed has told about things',
      'Open Data Atlas from the app bar, and find a thing by its name',
      'Open it, and read its answer, what is wrong with it and its key facts, each with whose report and when',
      'Open something around it, and come back',
    ],
    proof: 'A screenshot of the thing’s page, and the gateway’s record of the calls to /api/atlas/v1/find and /api/atlas/v1/things/<id>, each made as the person',
  },
];
