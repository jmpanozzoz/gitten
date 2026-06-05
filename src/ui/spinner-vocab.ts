type MessageSet = [string, ...string[]];

const vocab: Array<{ pattern: RegExp; messages: MessageSet }> = [
  {
    pattern: /loading branch info/i,
    messages: [
      "Archaeologizing branches...",
      "Carbon-dating commits...",
      "Dendrologizing the tree...",
      "Unearthing timestamps...",
      "Tracing the commit graph...",
    ],
  },
  {
    pattern: /loading branches/i,
    messages: [
      "Untangling forks...",
      "Arborizing refs...",
      "Surveying the forest...",
      "Mapping the DAG...",
    ],
  },
  {
    pattern: /loading context/i,
    messages: [
      "Spelunking .git...",
      "Interrogating HEAD...",
      "Reading the runes...",
      "Sniffing the repo...",
    ],
  },
  {
    pattern: /loading/i,
    messages: [
      "Materializing data...",
      "Reconstituting state...",
      "Hydrating atoms...",
      "Fetching the ether...",
    ],
  },
  {
    pattern: /staging/i,
    messages: [
      "Herding your changes...",
      "Corralling the diff...",
      "Marshalling edits...",
      "Staging the scene...",
    ],
  },
  {
    pattern: /committing/i,
    messages: [
      "Crystallizing changes...",
      "Fossilizing the diff...",
      "Engraving in history...",
      "Sealing the vault...",
    ],
  },
  {
    pattern: /no upstream.*push|push.*upstream/i,
    messages: [
      "Pioneering the upstream...",
      "Charting new territory...",
      "Establishing the lineage...",
      "Planting the flag on origin...",
    ],
  },
  {
    pattern: /push/i,
    messages: [
      "Upstreaming atoms...",
      "Beaming to origin...",
      "Catapulting commits...",
      "Propagating history...",
      "Displacing refs...",
    ],
  },
  {
    pattern: /pull/i,
    messages: [
      "Absorbing upstream...",
      "Ingesting remote state...",
      "Syncretizing branches...",
      "Downstreaming commits...",
    ],
  },
  {
    pattern: /creating branch/i,
    messages: [
      "Sprouting new branch...",
      "Bifurcating the timeline...",
      "Weaving a new ref...",
      "Forking reality...",
    ],
  },
  {
    pattern: /purg/i,
    messages: [
      "Redacting history...",
      "Memory-holing files...",
      "Obliterating traces...",
      "Shredding the evidence...",
      "Vacuuming the DAG...",
    ],
  },
  {
    pattern: /delet|clean|remov/i,
    messages: [
      "Excising dead branches...",
      "Defoliating the tree...",
      "Extirpating refs...",
      "Pruning relentlessly...",
    ],
  },
  {
    pattern: /cherry.pick|applying commit/i,
    messages: [
      "Transplanting commits...",
      "Grafting history...",
      "Suturing branches...",
      "Harvesting cherries...",
    ],
  },
  {
    pattern: /review/i,
    messages: [
      "Squinting at your code...",
      "Judging silently...",
      "Auditing the vibes...",
      "Consulting the oracle...",
      "Scrutinizing atoms...",
    ],
  },
  {
    pattern: /generat|suggest/i,
    messages: [
      "Hallucinating responsibly...",
      "Feeding the transformer...",
      "Awaiting the prophecy...",
      "Distilling meaning...",
      "Synthesizing wisdom...",
    ],
  },
  {
    pattern: /ai/i,
    messages: [
      "Whispering to the model...",
      "Sacrificing GPU cycles...",
      "Tickling the neural net...",
      "Awaiting divination...",
    ],
  },
  {
    pattern: /marking commit|bisect/i,
    messages: [
      "Triangulating the bug...",
      "Binary-searching history...",
      "Narrowing the culprit...",
    ],
  },
  {
    pattern: /adding worktree/i,
    messages: [
      "Materializing a worktree...",
      "Cloning the workspace...",
      "Forking the filesystem...",
    ],
  },
  {
    pattern: /removing worktree/i,
    messages: [
      "Collapsing the workspace...",
      "Vanishing the worktree...",
      "Reclaiming the void...",
    ],
  },
  {
    pattern: /stash/i,
    messages: ["Excavating shelved work...", "Unearthing the stash...", "Resurrecting changes..."],
  },
  {
    pattern: /tag/i,
    messages: ["Branding the commit...", "Stamping the release...", "Minting the version..."],
  },
  {
    pattern: /remote/i,
    messages: ["Wiring the remote...", "Establishing the link...", "Registering the origin..."],
  },
];

const fallback: MessageSet = [
  "Communing with git...",
  "Wrangling refs...",
  "Querying the DAG...",
  "Untangling history...",
  "Consulting the index...",
];

export function getSpinnerMessages(message: string): MessageSet {
  for (const entry of vocab) {
    if (entry.pattern.test(message)) {
      return entry.messages;
    }
  }
  return fallback;
}
