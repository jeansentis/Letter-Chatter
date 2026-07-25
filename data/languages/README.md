# Language packs

Save each extra dictionary as a UTF-8 `.txt` file in this folder. The filename is its stable setting ID, for example `nl.txt` or `de.txt`.

Use this format:

```text
# name: Nederlands
# flag: 🇳🇱
AAL
AAN
AARD
...
```

- Put `# name:` and `# flag:` at the top.
- Put one word per line after the metadata. Case does not matter.
- Words must contain only letters and be 3–15 letters long. Accented Unicode letters are supported.
- Blank lines and other lines beginning with `#` are ignored.
- Restart Letter Chatters after adding or replacing a file. It will then appear in the Language setting.

English remains built in and does not need a file.

You can enable any combination of installed packs at the same time using the language checkboxes in the dashboard.

The included Dutch, German, Western Frisian, Spanish, French, and Portuguese packs are generated from the open-source [wooorm/dictionaries](https://github.com/wooorm/dictionaries) collection. Their source links and license paths are recorded in each file. Run `npm run import-languages` to refresh all six packs from upstream.
