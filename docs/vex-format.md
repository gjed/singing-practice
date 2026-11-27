# The `.vex` format

A `.vex` file is one vocal exercise as plain text: ChordPro-style `{directives}` for metadata and settings, then pattern lines written in scale degrees. This page is the specification of format version 1. The parser, the linter, the editor and the exercise library are all written against it. The plan's [Exercise format](../plan/vocal-exercises-site-plan.md#exercise-format) section is the background; where the two differ, this page wins.

Version 1 has no version marker. The parser rejects everything this page does not define, so later versions can add syntax without changing the meaning of any valid file.

## A complete file

```text
{title: Major arpeggio}
{title.it: Arpeggio maggiore}
{description: Warm up the middle voice on an open vowel}
{focus: range, warm-up}
{technique: legato}
{level: beginner}

{defaults: start=C3 end=G4 tempo=100 step=+1 direction=up-down}
{param: scale = major | minor}
{vowel: ah}

{cue: [I:2]}
[I] 1 3 5 3 | 1:2 r:2
```

- A line that starts with `{` is a **directive line**, except the three conditional tokens `{if …}`, `{else}` and `{end}`, which belong to the pattern.
- Every other non-blank line is a **pattern line**.
- Degrees are relative to the current root, so the same pattern runs in every key the player steps through.

## File and lexical rules

| Rule               | Definition                                                                                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Encoding           | UTF-8. A leading byte order mark is ignored.                                                                                                                                                              |
| Line ends          | `\n` or `\r\n`. A lone `\r` is an error.                                                                                                                                                                  |
| Blank              | A space or a tab. No other whitespace character is allowed (a no-break space is an error).                                                                                                                |
| Blank lines        | Ignored. Indentation has no meaning.                                                                                                                                                                      |
| Case               | Everything is case-sensitive. Directive names, facet values, parameter names and scale names are lowercase. `r` is a rest and `R` is an error. Roman numerals keep their case because it carries meaning. |
| Comments           | None. The visual editor edits the parsed model and writes the text back, so a comment could not survive a round trip.                                                                                     |
| Control characters | U+0000 to U+001F (except tab) and U+007F are errors everywhere.                                                                                                                                           |
| Positions          | Line and column are 1-based. A column counts UTF-16 code units from the start of the line. A tab counts as one.                                                                                           |
| Size limits        | A file is at most 65 536 bytes and holds at most 1 024 pattern items (see [Pattern items](#pattern-items)). Both limits keep shared links cheap to parse.                                                 |

The parser never evaluates anything. A `.vex` file is data, so shared links and imported files can carry it safely (see the plan's [Security](../plan/vocal-exercises-site-plan.md#security) section).

## Directives

A directive is one line:

```text
{name: value}
{name.lang: value}
```

Blanks are allowed after `{`, around `:` and before `}`. The value runs to the first unescaped `}` on the same line and is trimmed. Nothing but blanks may follow the closing `}`. Directives can sit anywhere between pattern lines except inside an `{if}` block.

| Directive     | Required | Value                                     | Notes                                                                          |
| ------------- | -------- | ----------------------------------------- | ------------------------------------------------------------------------------ |
| `title`       | yes      | Text                                      | Display name. At most once.                                                    |
| `description` | no       | Text                                      | One line on what to focus on.                                                  |
| `author`      | no       | Text                                      | Credit, shown on the credits page.                                             |
| `focus`       | no       | One or more facet values, comma-separated | Facet. The first value decides the exercise's folder and accent colour.        |
| `technique`   | no       | One or more facet values, comma-separated | Facet.                                                                         |
| `level`       | no       | One facet value                           | Facet.                                                                         |
| `voice`       | no       | One facet value                           | Facet. Absent means `any`. Not the `voice` setting; see [Settings](#settings). |
| `defaults`    | no       | `key=value` pairs                         | Seeds the settings panel. See [Settings](#settings).                           |
| `param`       | no       | `name = a \| b \| c` or `name = 1..3`     | One directive per parameter. See [Parameters](#parameters).                    |
| `vowel`       | no       | One syllable                              | Sung on every note that has no `/syllable`.                                    |
| `cue`         | no       | One chord, `[I:2]`                        | What plays before each repetition. See [Chords](#chords).                      |
| `meter`       | no       | An integer, 1 to 16                       | Beats per bar. Turns on [bar checking](#bar-checking).                         |

Every directive except `param` is allowed at most once per file, and `param` at most once per name. A translation counts separately: `title` and `title.it` are different directives.

### Text values

`title`, `description` and `author` hold free text: any characters except control characters. `}` and `\` must be escaped as `\}` and `\\`. `{` needs no escape. The value must not be empty after trimming.

```text
{description: Open the \} vowel, then \\ slide}
```

Structured values (everything else) have no escapes. A `\` in them is an error.

### Facet values

The facet directives are `focus`, `technique`, `level` and `voice`. `focus` and `technique` take a comma-separated list, `level` and `voice` take exactly one value. A list item is lowercase letters and digits, with single spaces or hyphens between words (`range`, `warm-up`, `lip trill`).

The parser checks the shape only. The vocabulary is in `site/data/facets.yaml` (added by [#4](https://github.com/gjed/singing-practice/issues/4)), and `vex lint` rejects any value that file does not list. This page does not copy the vocabulary, so there is one source of truth. Policy beyond the format, such as requiring `focus` in library files, also belongs to `vex lint`.

### Translations

`<directive>.<lang>` gives a translation of a directive. A language code is two or three lowercase letters.

- Only `title` and `description` are translatable. `focus`, `technique`, `level` and `voice` are labelled through `facets.yaml`, and `author` is a name.
- The plain directive is the English text, so `.en` is an error.
- Each translation appears at most once per language.
- A missing translation falls back to English. `vex lint` warns about it and checks the code against the languages the site ships; the parser accepts any well-formed code.

```text
{title: Siren}
{title.it: Sirena}
{description.it: Scivolo continuo su "ng"}
```

## Pattern

The pattern is the body of the file: pattern lines, one after another, played in order. Line breaks have no musical meaning, except that a line end closes a bar when `{meter}` is set. Pattern items are separated by at least one blank, except around `|`.

### Pattern items

| Token                 | Meaning                                                                        | Example                           |
| --------------------- | ------------------------------------------------------------------------------ | --------------------------------- |
| Degree `1`…`7`        | Scale degree in the current scale                                              | `1`, `5`                          |
| Degree `8`, `9`, `10` | Degrees above the octave. `8` is `1` one octave up, `9` is `2'`, `10` is `3'`  | `8`                               |
| `b`, `#`              | Lowers or raises the degree by one semitone, written before it. One mark only  | `b3`, `#4`                        |
| `,` `'`               | Same degree one octave below or above. Up to three marks of one kind           | `5,`, `5'`, `1''`                 |
| `:2`, `:1/2`          | Duration in beats, after the note. Default 1                                   | `3:2`, `1:1/2`, `1:1/4`           |
| `r`                   | Rest. Takes a duration                                                         | `r`, `r:2`                        |
| `1~5`                 | Glide from one pitch to another over the note's duration                       | `1~5`, `1~8:4`                    |
| `1/ma`                | Syllable shown and sung for that note, after the pitch and before the duration | `1/ma`, `1/ah:2`                  |
| `[I]`, `[V7:2]`       | Accompaniment chord                                                            | `[I]`, `[ii7]`                    |
| `[-]`                 | Stops the chord                                                                | `[-]`                             |
| `\|`                  | Bar line                                                                       | `3 \| 1:2`                        |
| `{if name=value}`     | Conditional, with `{else}` and `{end}`                                         | see [Conditionals](#conditionals) |

Each note, rest, chord, bar line and conditional token counts as one **pattern item**. A file holds at most 1 024 of them, counting every branch of every conditional. It needs at least one note or rest.

A note is `[accidental] degree [octave marks]`, optionally followed by `~` and a second pitch of the same shape, then optionally `/syllable`, then optionally `:duration`. The order is fixed.

```text
5,            degree 5, one octave down
b3'           flat 3, one octave up
#4:1/2        sharp 4, half a beat
1~8/ng:4      glide from 1 up to 8, sung on "ng", four beats
```

#### Degrees and alteration

Degrees 1 to 7 resolve through the scale chosen by the `scale` parameter (default `major`). The accidental then moves the resolved pitch by one semitone, so in `minor` the degree `3` is already a minor third and `b3` is a semitone below that. Octave marks move a note by a whole octave. A degree is 1 to 10 without leading zeros; `0`, `11` and `07` are errors.

Scales are a closed list owned by this spec: `major`, `minor`, `harmonic-minor`, `dorian`.

#### Durations

A duration is `:` followed by a positive integer or a fraction. Rules:

- The value is in beats, the unit of `tempo`.
- The numerator is a positive integer. The denominator is 2 or 4. `:1/2` is a half beat, `:1/4` a quarter beat and `:3/2` a beat and a half.
- The value is at most 64 beats.
- A fraction without the colon (`1/2`) is not a duration. After a pitch, `/` must start a syllable.

#### Syllables

A syllable is one to 16 letters, counted in code points: any Unicode letter, with its combining marks, each mark counting as one. `ma`, `ng`, `brr` and `mm` are syllables. The syllable text is kept as written. A glide takes one syllable for the whole glide.

#### Rests

`r` is a rest of 1 beat, or `r:duration`. A rest takes no syllable and no pitch.

### Chords

A chord is a Roman numeral in brackets. The numeral names the scale degree of the chord root in the current scale, and its case and suffix name the chord quality.

| Written           | Chord                      |
| ----------------- | -------------------------- |
| `I`, `IV`, `V`    | Major triad on that degree |
| `ii`, `iii`, `vi` | Minor triad                |
| `V7`              | Dominant seventh           |
| `ii7`             | Minor seventh              |
| `Imaj7`           | Major seventh              |
| `viidim`          | Diminished triad           |

- The numeral is `I` to `VII` in upper case or `i` to `vii` in lower case.
- The suffix is empty, `7`, `maj7` or `dim`. `maj7` needs an upper-case numeral and `dim` a lower-case one.
- Chromatic roots such as `bVII` are not in version 1.
- The voicing is the engine's decision, not the format's. Chords are always block chords.

**In the body**, a chord takes no time. It sounds from where it is written until the next chord, `[-]` or the end of the pattern, whichever comes first. An optional duration `[V7:2]` caps the hold at that many beats. The chord does not move the beat position, and a chord that is replaced early is simply cut off.

```text
[I] 1 3 5 3 [V7] 2 4 5 [-] r
```

**In `{cue: …}`**, the chord is what plays before each repetition. Its duration is how long it sounds and defaults to 1 beat. `[-]` is not allowed there and is an `invalid-chord` error. Without a `{cue}` directive nothing plays before a repetition and the `cue` setting has no effect.

### Bar lines

`|` marks a bar line. It can touch its neighbours (`3|1`). Bar lines are optional, and an empty bar (a leading or doubled `|`) is ignored. What they are checked against is in [Bar checking](#bar-checking).

### Conditionals

`{if name=value} … {else} … {end}` is the only conditional, and it is the limit for version 1.

```text
{param: speed = 1..3}
{if speed=3} 1 2 3 4 5 4 3 2 1:2 {else} 1 3 5 3 1:2 {end}
```

- `name` is a declared `{param}`, and `value` is one of its values (see [Parameters](#parameters)). Blanks around `=` are allowed.
- `{else}` is optional. `{if}` blocks do not nest, and there is no `and`, `or`, `not`, `else if` or comparison other than equality.
- A block can span lines: the tokens are pattern items, and line ends inside a block are fine.
- A directive line inside a block is an error.
- An `{if}` block is an opaque lane for the visual editor, which shows it locked.

The pattern is the union of the branches: the engine picks one branch per `{if}` from the current parameter value, and the parser keeps both.

## Parameters

`{param: name = …}` makes a control in the settings panel, with no code.

```text
{param: scale = major | minor | harmonic-minor | dorian}
{param: vowel = ah | eh | ee | oh | oo}
{param: speed = 1..3}
```

| Form          | Control  | Values                                                                                                         |
| ------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `a \| b \| c` | Dropdown | Two or more distinct values; the first is the default                                                          |
| `1..3`        | Slider   | Integers from the first number to the second, which must be larger; the first is the default. Both are 0 to 99 |

- A name is lowercase letters, digits and hyphens, starting with a letter. A value is lowercase letters, digits and hyphens, starting with a letter or a digit.
- A name must not be a setting name (`start`, `end`, `voice`, `tempo`, `step`, `direction`, `cue`, `count-in`).
- `scale` is special: it selects the scale for degree resolution, and its values must come from the scale list above. Without it the scale is `major`.
- `vowel` as a parameter chooses the vowel for notes without a syllable. A file cannot have both `{vowel: …}` and `{param: vowel = …}`.
- An `{if}` value must be one of the listed values for a dropdown, or an integer inside the range for a slider.
- `{defaults: name=value}` sets a different default for a parameter. A parameter's value for a run comes from the same layers as a setting (see [Resolution order](#resolution-order)).

## Settings

The file has two layers. The **pattern** is what the exercise is: the body lines, `cue`, `param`, `vowel` and `meter`. The **settings** are how a run goes. They are the same for every exercise, so the player shows one fixed control panel. `{defaults}` only seeds that panel.

A rule of thumb: if changing a value changes which exercise it is, it belongs in the pattern, and the singer can only reach it through a `{param}` the author offers. If it only changes how the run goes, it is a setting.

| Setting        | Meaning                                                  | Value syntax                                            | Built-in   |
| -------------- | -------------------------------------------------------- | ------------------------------------------------------- | ---------- |
| `start`, `end` | Lowest and highest root of the run, with `start` ≤ `end` | Note name: `C3`, `Bb2`, `F#4`                           | `C3`, `C4` |
| `voice`        | Preset that fills `start` and `end`                      | `soprano`, `mezzo`, `alto`, `tenor`, `baritone`, `bass` | none       |
| `tempo`        | Beats per minute                                         | Integer, 20 to 300                                      | `100`      |
| `step`         | Semitones between repetitions                            | `+1` to `+12`, with the sign                            | `+1`       |
| `direction`    | Order of roots                                           | `up`, `down`, `up-down`, `down-up`                      | `up`       |
| `cue`          | Play the `{cue}` before each repetition                  | `on`, `off`                                             | `on`       |
| `count-in`     | Clicks before the first cue                              | `off`, or `1bar` to `4bar`                              | `1bar`     |

- A note name is a letter `A`–`G`, an optional `#` or `b`, an optional `-`, and one octave digit, in scientific pitch notation: `C4` is middle C, MIDI 60. The result must be MIDI 0 to 127.
- `step` is always positive. The `direction` setting decides which way the roots run.
- A bar for `count-in` is `{meter}` beats, or 4 beats without `{meter}`. The panel shows `1bar` as "1 bar".
- `voice` and `cue` here are settings. They are not the `voice` facet directive and the `{cue}` directive, which are separate things.
- The preset ranges behind `voice` are not part of the format.

### Defaults

`{defaults: key=value key=value …}` has pairs separated by blanks, with no blanks around `=`. A key is a setting name or a declared `{param}` name, each at most once. A `voice` pair expands into `start` and `end`, but an explicit `start` or `end` in the same directive wins over it.

```text
{defaults: start=A2 end=E4 tempo=120 direction=up-down}
```

### Resolution order

Each setting resolves on its own: the highest layer that sets it wins, and a later layer wins over an earlier one.

1. The exercise's `{defaults}`.
1. The singer's saved range. It sets only `start` and `end`.
1. URL parameters, for example `&tempo=90&start=A2`. They can set any setting and any parameter.
1. The control panel.

A setting that no layer sets takes the built-in value in the table above. A layer that sets `voice` sets `start` and `end` at that layer. A value from the saved range, the URL or the panel that does not fit the syntax above is ignored, and the layer below it applies. In `{defaults}` the same value is an error.

`start` must not be above `end`. Layers are applied from the lowest to the highest, a layer's `start` and `end` together. If applying a layer would leave `start` above `end`, that layer's `start` and `end` are ignored and the result of the layers below stays. So a panel value of `D4` for `start` is ignored while `end` is `C4`, and the singer has to move `end` first or set both. In `{defaults}` the same case is a `range-order` error.

For example, with `{defaults: start=C3 end=G4 tempo=100}`, a saved range of `A2` to `E4` and a URL of `&tempo=90`, the run uses `A2` to `E4` at tempo 90. If the singer then drags the tempo slider to 80, the run is `A2` to `E4` at 80.

## Bar checking

Beats are counted exactly, in quarter beats. A note or rest adds its duration. A chord adds nothing.

**Without `{meter}`**, bar lines are only visual. Nothing is checked, and bars of different lengths are valid. `exercises/range/02-octave-jump.vex` is a valid file with bars of 3 and 4 beats:

```text
{defaults: start=C3 end=F4 tempo=90}
[I] 1:1/2 8:1/2 5 3 | 1:2 r:2
```

**With `{meter: N}`**, every bar must add up to exactly `N` beats. A bar ends at a `|`, at the end of a pattern line, and at `{if}`, `{else}` and `{end}`. An empty bar is ignored. A bar that does not add up is a `bar-length` error that reports the beats it expected and the beats it found.

- Because a conditional token ends the bar, an `{if}` block starts and ends on a bar line when `{meter}` is set. Each branch is a whole number of bars.
- `{meter: N}` is a count of beats, not a time signature, so `{meter: 4/4}` is an error. A beat is the unit of `tempo` and of durations.

```text
{meter: 4}
[I] 1 2 3 4 | 5 4 3 2 | 1:2 r:2
```

## Grammar

The grammar is in two parts: a scannerless character grammar for lines and pattern items, and a token grammar for the structure of the file. Notation: `=` defines, `;` ends a rule, `{ x }` is zero or more, `[ x ]` is optional, `|` is a choice, `"…"` is literal text, `"a".."z"` is a range, `(* … *)` is a comment, and `? … ?` is a prose condition. Blanks are not allowed inside a rule unless the rule says so.

### Characters and lines

```ebnf
blank        = " " | "\t" ;
digit        = "0".."9" ;
lower        = "a".."z" ;
letter       = ? any Unicode letter or combining mark ? ;
nonctrl      = ? any character except U+0000..U+001F other than tab, and U+007F ? ;
eol          = "\n" | "\r\n" | ? end of input ? ;
int          = digit { digit } ;
ident        = lower { lower | digit | "-" } ;
vtoken       = ( lower | digit ) { lower | digit | "-" } ;

file         = { line } ;
line         = { blank } ( directive | pattern-line | (* empty *) ) { blank } eol ;
```

A line is a directive line if its first non-blank character is `{` and what follows (after blanks) is not `if`, `else` or `end` ending at a character outside `lower digit -`. Otherwise it is a pattern line, or blank.

### Directive grammar

```ebnf
directive    = "{" { blank } name [ "." lang ] { blank } ":" { blank } value { blank } "}" ;
name         = "title" | "description" | "author" | "focus" | "technique" | "level"
             | "voice" | "defaults" | "param" | "vowel" | "cue" | "meter" ;
lang         = lower lower [ lower ] ;            (* not "en"; title and description only *)

value        = text | facet-list | facet | syllable | chord | int
             | settings | param-def ;             (* chosen by name; see the table above *)

text         = text-char { text-char } ;
text-char    = ( nonctrl - "}" - "\" ) | "\\" | "\}" ;

facet-list   = facet { { blank } "," { blank } facet } ;
facet        = word { ( " " | "-" ) word } ;
word         = ( lower | digit ) { lower | digit } ;

settings     = setting { blank { blank } setting } ;
setting      = ident "=" setting-value ;
setting-value = note-name | int | "+" int | vtoken | int "bar" ;  (* typed by key; see Settings *)
note-name    = ( "A".."G" ) [ "#" | "b" ] [ "-" ] digit ;

param-def    = ident { blank } "=" { blank } ( vtoken-list | int ".." int ) ;
vtoken-list  = vtoken { blank } "|" { blank } vtoken { { blank } "|" { blank } vtoken } ;
```

The value of a directive is the text between the first `:` and the first unescaped `}` on the line, trimmed. A `title`, `description` or `author` value uses `text` with its escapes. Every other value is tokenised on the structured syntax above, and `\` is not valid in it.

### Pattern item grammar

```ebnf
pattern-line = [ item { gap item } ] ;
gap          = blank { blank } | "" ;             (* "" only next to a bar line *)

item         = note | rest | chord | bar | if | else | end ;

note         = pitch [ "~" pitch ] [ "/" syllable ] [ duration ] ;
pitch        = [ "b" | "#" ] int [ octave ] ;
octave       = "," [ "," [ "," ] ] | "'" [ "'" [ "'" ] ] ;
duration     = ":" int [ "/" int ] ;
syllable     = letter { letter } ;                (* 1 to 16 code points *)

rest         = "r" [ duration ] ;

chord        = "[" ( "-" | numeral [ quality ] [ duration ] ) "]" ;
numeral      = ( "I" | "V" ) { "I" | "V" } | ( "i" | "v" ) { "i" | "v" } ;
quality      = "7" | "maj7" | "dim" ;

bar          = "|" ;

if           = "{" { blank } "if" blank { blank } ident { blank } "=" { blank } vtoken { blank } "}" ;
else         = "{" { blank } "else" { blank } "}" ;
end          = "{" { blank } "end" { blank } "}" ;
```

Rules the grammar cannot show:

- **Longest run.** An `int` is the longest run of digits. A `numeral` is the longest run of `I V` or of `i v`, and `quality` starts at the first character that run cannot take.
- **Slash after a duration.** In `:` `int` `/`, the slash continues the duration only if a digit follows. Otherwise the duration ends and the next character is checked as a separator.
- **Separation.** After an item other than `|`, the next character is a blank, `|` or the end of the line. Anything else is an `expected-blank` error, which also covers `1:2/ma`, `5,3`, `1b3` and `[I]1`. Text inside the brackets is the chord's own business: `[I x]` is `invalid-chord`, `[I]x` is `expected-blank`.
- **Meaning checks on tokens.** `int` in a pitch is 1 to 10 with no leading zero. A numeral is one of the seven forms in the chord table. `maj7` needs an upper-case numeral and `dim` a lower-case one. A duration is a positive integer, or `int "/" int` with a denominator of 2 or 4, and its value is at most 64 beats. A syllable is at most 16 code points.
- **Atom starts.** An item starts with `b`, `#`, a digit, `r`, `[`, `|` or `{`. `{` must be `{if …}`, `{else}` or `{end}`; any other directive in the middle of a line is a `misplaced-directive` error.

### File structure

The token grammar below works on a stream of tokens: `DIRECTIVE` (a whole directive line), `NEWLINE` (a line end), `IF`, `ELSE`, `END`, and `plain` (a `note`, `rest`, `chord` or `bar`).

```ebnf
file-tokens  = { DIRECTIVE | NEWLINE | plain | conditional } ;
conditional  = IF { plain | NEWLINE } [ ELSE { plain | NEWLINE } ] END ;
```

Anything that does not fit is an error: `ELSE` or `END` outside an open block, a second `ELSE`, `IF` inside a block (`nested-if`), `DIRECTIVE` inside a block (`directive-in-conditional`), or the end of the file with a block still open (`unclosed-if`).

### Recursive descent

A hand-written parser follows this order:

1. Strip the byte order mark and check the size limit. Split into lines.
1. Classify each line as blank, directive or pattern.
1. A directive line: read the name, check it against the table, check the optional language suffix, read the value up to `}`, then parse the value with the grammar for that name.
1. A pattern line: read items left to right with one character of lookahead. Dispatch on the first character: `b` `#` digit → `note`; `r` → `rest`; `[` → `chord`; `|` → `bar`; `{` → `if`, `else` or `end`.
1. Build the `{if}` structure with a stack of depth at most 1.
1. Only when no syntax error was found, run every file-level check in the next section and report all violations.

## Errors

Every error carries `line`, `column`, a stable `code` and a human `message`. Tests compare `code`, `line` and `column`; the message wording is free.

A parser reports every error it finds, sorted by line and then column, so the editor and `vex lint` can show every problem. For syntax errors it recovers at the next line and reports at most one per line. A file with any error has no AST. File-level errors are reported only when there are no syntax errors, because they depend on the whole file.

The column is the first character the grammar cannot accept. At the end of a line it is the column just past the last character. The tables below name the position for each code.

### Syntax errors

| Code                       | Condition                                                                                                                                                                                                                                         | Position                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `file-too-large`           | More than 65 536 bytes                                                                                                                                                                                                                            | 1:1                                           |
| `unexpected-character`     | A character that no rule accepts here: a lone `\r`, a control character, a stray `}`, or text after a directive's `}`                                                                                                                             | That character                                |
| `unterminated`             | A `{` or `[` with no closing `}` or `]` on its line                                                                                                                                                                                               | The opening character                         |
| `unknown-directive`        | A name not in the directive table, including reserved names (see [Reserved](#reserved))                                                                                                                                                           | Start of the name                             |
| `misplaced-directive`      | A directive in the middle of a pattern line                                                                                                                                                                                                       | The `{`                                       |
| `invalid-translation`      | A `.lang` on a directive that is not `title` or `description`, a malformed code, or `.en`                                                                                                                                                         | The `.`                                       |
| `missing-value`            | No `:`, or an empty value                                                                                                                                                                                                                         | Where the `:` or the value was expected       |
| `invalid-value`            | A value that does not match its directive's syntax, including a bad escape, a bad note name, a setting outside its range, a parameter list with one value or a repeated value, a range that does not increase, and a scale outside the scale list | See below the table                           |
| `expected-blank`           | An item is followed by something other than a blank, `\|` or the end of the line                                                                                                                                                                  | That character                                |
| `invalid-degree`           | A degree that is not 1 to 10, has a leading zero, or is missing after `b`, `#` or `~`                                                                                                                                                             | Start of the number, or where it should start |
| `invalid-duration`         | A zero numerator, a denominator other than 2 or 4, or a value over 64 beats                                                                                                                                                                       | The `:`                                       |
| `invalid-syllable`         | A `/` not followed by a letter, or a syllable over 16 code points                                                                                                                                                                                 | The character after the `/`                   |
| `invalid-chord`            | Anything in brackets that is not a chord: an empty `[]`, a numeral that is not one of the seven forms, a suffix that is not allowed or does not match the case, `[-]` with a duration or as a `{cue}`, or text between the chord and the `]`      | The first character after `[`                 |
| `invalid-conditional`      | A malformed `{if}`, `{else}` or `{end}`, including `{else if …}` and operators other than `=`                                                                                                                                                     | The offending character                       |
| `nested-if`                | `IF` inside an open block                                                                                                                                                                                                                         | The inner `{if`                               |
| `unmatched-conditional`    | `ELSE` or `END` with no open block, or a second `ELSE`                                                                                                                                                                                            | The `{` of that token                         |
| `directive-in-conditional` | A directive line inside an open block                                                                                                                                                                                                             | The `{`                                       |
| `unclosed-if`              | The file ends with a block still open                                                                                                                                                                                                             | The `{` of the `{if`                          |
| `too-many-items`           | More than 1 024 pattern items                                                                                                                                                                                                                     | The 1 025th item                              |

**Position of `invalid-value`.** If the value does not match the grammar, the column is the first character the grammar rejects: `{meter: 4/4}` is rejected at the `/`, and a one-value list such as `{param: a = x}` at the position just past the value. If the value is well formed but not allowed, the column is the first character of the offending value or list item:

- `{defaults: tempo=500}` at the `500`, and `{meter: 17}` at the `17`.
- `{param: scale = major | foo}` at the `foo`.
- `{param: a = x | x}` at the second `x`.
- `{param: speed = 3..1}` at the second number.

### File-level errors

These run only when the file has no syntax error. Every check runs even if an earlier one failed, and every violation is reported. When a name is declared twice, later checks use its first declaration. Errors at the same position follow the order of this table.

For example, `{defaults: foo=1 start=G4 end=C4}` gives `unknown-key` at `foo` and `range-order` at `end`.

| Code                     | Condition                                                                                                                                             | Position                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `missing-title`          | No `{title}`                                                                                                                                          | 1:1                                                                                  |
| `missing-pattern`        | No note and no rest in the file                                                                                                                       | 1:1                                                                                  |
| `duplicate-directive`    | A directive, translation or `{param}` name that appears twice, or a `{defaults}` key that appears twice                                               | The `{` of the second directive, or the second key                                   |
| `reserved-param-name`    | A parameter named like a setting                                                                                                                      | The parameter name                                                                   |
| `conflicting-directives` | `{vowel}` and `{param: vowel}` in one file                                                                                                            | The `{` of the later one                                                             |
| `unknown-key`            | A `{defaults}` key that is neither a setting nor a declared parameter                                                                                 | The key                                                                              |
| `invalid-param-value`    | A `{defaults}` pair or an `{if}` whose value the parameter does not allow                                                                             | The value                                                                            |
| `range-order`            | `{defaults}` puts `start` above `end`. A lone `start` or `end` is compared with the built-in value of the other. Not checked when `voice` is also set | The `end` key, or the only bound that is set                                         |
| `unknown-param`          | An `{if}` that names an undeclared parameter                                                                                                          | The name                                                                             |
| `bar-length`             | With `{meter}`, a bar that does not add up to the meter                                                                                               | The token that ends the bar: `\|`, `{if}`, `{else}`, `{end}`, or the end of the line |

## Reserved

Four decisions are open and are not part of version 1. Each is reserved: the parser rejects any syntax for it, so a later version can add it without changing a valid file.

| Topic                                                                            | Version 1 rule                                         | Rejected as                                                                                   |
| -------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Dynamics ([#35](https://github.com/gjed/singing-practice/issues/35))             | No dynamics syntax: no hairpins, no velocity directive | `1:8<>` is `expected-blank` at the `<`; a `{dynamics: …}` directive is `unknown-directive`    |
| Accompaniment styles ([#36](https://github.com/gjed/singing-practice/issues/36)) | Block chords only                                      | A style directive is `unknown-directive`; a style setting in `{defaults}` is `unknown-key`    |
| Tuning ([#37](https://github.com/gjed/singing-practice/issues/37))               | A = 440 Hz, fixed                                      | A `{tuning: …}` directive is `unknown-directive`; a `tuning=` pair is `unknown-key`           |
| Raw Strudel ([#38](https://github.com/gjed/singing-practice/issues/38))          | No raw Strudel blocks                                  | A `{strudel: …}` directive is `unknown-directive`. Nothing in a `.vex` file is ever evaluated |

Every unknown directive name and settings key is an error, so these names stay free for later.

## Conformance examples

Use these as parser fixtures. Positions are `line:column`.

### Valid

Each line below is a pattern line. The right column is the item sequence the parser must produce.

| Pattern line                                                | Items                                                                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `[I] 1 3 5 3 \| 1:2 r:2`                                    | chord I; notes 1, 3, 5, 3; bar; note 1 for 2 beats; rest for 2 beats                                                                 |
| `[I] 1/ma 2/me 3/mi 4/mo 5/mu 4 3 2 \| 1:2 r:2`             | chord I; notes 1 to 5 with syllables `ma me mi mo mu`; notes 4, 3, 2; bar; note 1 for 2 beats; rest for 2 beats                      |
| `[I] 1:1/2 8:1/2 5 3 \| 1:2 r:2`                            | chord I; note 1 for half a beat; note 8 for half a beat; notes 5, 3; bar; note 1 for 2 beats; rest for 2 beats                       |
| `[I] 1~8:4 8~1:4 \| r:4`                                    | chord I; glide 1 to 8 for 4 beats; glide 8 to 1 for 4 beats; bar; rest for 4 beats                                                   |
| `5, 5' b3 #4 10`                                            | five notes: 5 down an octave, 5 up an octave, flat 3, sharp 4, degree 10                                                             |
| `1:1/4 2:1/4 3:3/2`                                         | notes 1 and 2 for a quarter beat, note 3 for a beat and a half                                                                       |
| `1~b3'/ng:2`                                                | glide from 1 to flat 3 an octave up, syllable `ng`, 2 beats                                                                          |
| `[I] 1 [V7:2] 5 [-] r`                                      | chord I; note 1; chord V7 capped at 2 beats; note 5; chord off; rest                                                                 |
| `[ii7] 2 [viidim] 7`                                        | chord ii7; note 2; chord viidim; note 7                                                                                              |
| `{if speed=3} 1 2 3 4 5 4 3 2 1:2 {else} 1 3 5 3 1:2 {end}` | `IF` speed=3; nine notes of the first branch; `ELSE`; the five notes of the second; `END`. Needs `{param: speed = 1..3}` in the file |

The directive lines of the four sample files and of the plan examples are valid too:

```text
{defaults: start=A2 end=E4 tempo=120 direction=up-down}
{defaults: start=C3 end=G4 tempo=100 step=+1 direction=up-down}
{defaults: start=C3 end=C4 tempo=60 step=+2}
{focus: range, warm-up}
{param: scale = major | minor}
{param: vowel = ah | eh | ee | oh | oo}
{param: speed = 1..3}
{vowel: ng}
{cue: [I:2]}
```

### Rejected

| Source                            | Result                       | Why                                                            |
| --------------------------------- | ---------------------------- | -------------------------------------------------------------- |
| `{meter: 4/4}`                    | `invalid-value` at 1:10      | `meter` is a beat count, not a time signature                  |
| `[I] 1:0`                         | `invalid-duration` at 1:6    | A duration is positive                                         |
| `1 2 3 11`                        | `invalid-degree` at 1:7      | Degrees stop at 10                                             |
| `1:2/ma`                          | `expected-blank` at 1:4      | The syllable goes before the duration                          |
| `[I]1 3`                          | `expected-blank` at 1:4      | A chord is followed by a blank, `\|` or the end of the line    |
| `1/2`                             | `invalid-syllable` at 1:3    | `/` after a pitch starts a syllable; the fraction needs `:1/2` |
| `{if a=1} {if b=2} 1 {end} {end}` | `nested-if` at 1:10          | One level only                                                 |
| `{title.en: Arpeggio}`            | `invalid-translation` at 1:7 | The plain directive is the English text                        |
| `{title: Siren`                   | `unterminated` at 1:1        | A directive closes on its own line                             |
| `[V7:2`                           | `unterminated` at 1:1        | A chord closes on its own line                                 |
| `[bVII] 1`                        | `invalid-chord` at 1:2       | No chromatic roots in version 1                                |
| `1 {title: x}`                    | `misplaced-directive` at 1:3 | Directives start a line                                        |
| `{strudel: note("c e g")}`        | `unknown-directive` at 1:2   | Reserved; see [Reserved](#reserved)                            |

With `{param: speed = 1..3}` and `{meter: 4}` in the file, the `{if}` line from the valid table is rejected: the first branch ends mid-bar, so `bar-length` is reported at the `{else}`. Write it with bar lines to make it valid under a meter:

```text
{param: speed = 1..3}
{meter: 4}
{if speed=3} 1 2 3 4 | 5 4 3 2 | 1:2 r:2 {else} 1 3 5 3 | 1:2 r:2 {end}
```
