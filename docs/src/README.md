# Guide sources

`make.js` holds the guide's content and builds the `.docx`. `render_md.js`
re-runs the same content block through Markdown helpers, so the Word and
Markdown versions cannot drift apart.

```bash
npm install docx
node make.js ../MiniMax-H3-Prompt-Builder-Beginners-Guide.docx
node render_md.js ../minimax-h3-prompt-builder.md
```

Edit `make.js` only; both outputs are generated.
