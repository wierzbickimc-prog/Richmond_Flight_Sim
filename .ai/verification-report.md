# Finding verification

## F1 -- needs_more_evidence

Claim: Missile fire keybinding remains KeyX; HUD and README lack V instruction
Evidence: The diff for src/controls.js confirms `case 'KeyX': onFire && onFire(); break;` is present, supporting the 'keybinding remains KeyX' portion. However, the finding also claims 'index.html .panel-controls has no V row' and 'README.md Controls table ends at B / Space,' and neither index.html nor README.md is included in the provided excerpts. The uncommitted diff touches only package-lock.json, src/controls.js, and src/main.js; no diff or file content is given for index.html or README.md. To settle the HUD/README portions I would need the full text of index.html (specifically the .panel-controls section) and README.md (specifically the Controls table around line 73).
