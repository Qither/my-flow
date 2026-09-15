# Context digest diagnostic during V-4

User reports Claude high planning completed three rounds, ending in architect WATCH and
critic OKAY against contract 810b5e4017afdc82dec813d169d3aa5597ad671fd9145caa1ff1551e2a67343b.
It also reports no-such-packet from --since and differing Inputs/contract digests.

These digests have distinct purposes: context.inputsDigest hashes packet.inputs, including
the contract digest, mode, task selection, blocks, constraints, source locators and findings.
The --since lookup resolves a previously persisted inputsDigest for the same mode/task.
Review records instead bind contractDigest. Equal values are neither expected nor required.

One local diagnostic used the already-persisted first-review packet's actual inputsDigest:
23611ad7cbf44fcee62a15bd25649e2b29c9d5d6a54f153605e3a377473ab2d0.
Its embedded contractDigest is 072f681dde292e279860edea5bfdc13a94201d06e11e1ab628356aa314169e40.
The canonical candidate command `context high --since <inputsDigest> --json` returned exit 0,
known true, unchanged false, and actual contract/constraint/acceptance/design/locator changes
through the final 810b5e4017af contract. Output resides in the isolated candidate under
observations/v4-context-correct-inputs-digest.stdout.txt; complete child isolation metadata
is in observations/commands.jsonl. Only derived scratch context was written.

No implementation edits, planning reruns or model probes were performed. The existing native
failed --since call arguments remain for the independent observer to identify the original cause.
The reported difference between digests by itself is not a defect.
