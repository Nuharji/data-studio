//! The formula functions the engine (formula.rs) knows, with syntax, description and example in English and German —
//! for the syntax guide while typing a formula and the function list in Help. A test keeps this list and the engine in sync.

use serde::Serialize;

#[derive(Serialize, Debug)]
pub struct Arg {
    en: &'static str,
    de: &'static str,
    /// may be left out
    optional: bool,
    /// may be repeated (number1, number2, …)
    repeat: bool,
}

#[derive(Serialize, Debug)]
pub struct Func {
    /// English name (the engine's)
    name: &'static str,
    /// German name (also accepted in formulas)
    de: &'static str,
    /// math, stats, logic, text, date
    cat: &'static str,
    args: Vec<Arg>,
    desc_en: &'static str,
    desc_de: &'static str,
    example_en: &'static str,
    example_de: &'static str,
}

/// Argument spec: "en|de", with a leading "?" for optional and a trailing "…" for repeatable.
fn args(spec: &[&'static str]) -> Vec<Arg> {
    spec.iter().map(|s| {
        let optional = s.starts_with('?');
        let s = s.trim_start_matches('?');
        let repeat = s.ends_with('…');
        let (en, de) = s.trim_end_matches('…').split_once('|').unwrap_or((s, s));
        Arg { en, de, optional, repeat }
    }).collect()
}

type Row = (&'static str, &'static str, &'static str, &'static [&'static str], &'static str, &'static str, &'static str, &'static str);

const TABLE: &[Row] = &[
    ("SUM", "SUMME", "math", &["number1|Zahl1", "?number2|Zahl2…"], "Adds numbers and ranges.", "Addiert Zahlen und Bereiche.", "=SUM(B1:B10)", "=SUMME(B1:B10)"),
    ("AVERAGE", "MITTELWERT", "stats", &["number1|Zahl1", "?number2|Zahl2…"], "Average (arithmetic mean) of the numbers.", "Mittelwert (Durchschnitt) der Zahlen.", "=AVERAGE(B1:B10)", "=MITTELWERT(B1:B10)"),
    ("MIN", "MIN", "stats", &["number1|Zahl1", "?number2|Zahl2…"], "Smallest number.", "Kleinste Zahl.", "=MIN(B1:B10)", "=MIN(B1:B10)"),
    ("MAX", "MAX", "stats", &["number1|Zahl1", "?number2|Zahl2…"], "Largest number.", "Größte Zahl.", "=MAX(B1:B10)", "=MAX(B1:B10)"),
    ("COUNT", "ANZAHL", "stats", &["value1|Wert1", "?value2|Wert2…"], "Counts the cells that contain numbers.", "Zählt die Zellen, die Zahlen enthalten.", "=COUNT(B1:B10)", "=ANZAHL(B1:B10)"),
    ("COUNTA", "ANZAHL2", "stats", &["value1|Wert1", "?value2|Wert2…"], "Counts the cells that are not empty.", "Zählt die Zellen, die nicht leer sind.", "=COUNTA(A1:A10)", "=ANZAHL2(A1:A10)"),
    ("COUNTIF", "ZÄHLENWENN", "stats", &["range|Bereich", "criterion|Suchkriterium"], "Counts the cells that meet a condition, e.g. \">10\", \"<>x\" or a value.", "Zählt die Zellen, die eine Bedingung erfüllen, z. B. \">10\", \"<>x\" oder ein Wert.", "=COUNTIF(C1:C10, \">100\")", "=ZÄHLENWENN(C1:C10; \">100\")"),
    ("SUMIF", "SUMMEWENN", "math", &["range|Bereich", "criterion|Suchkriterium", "?sum_range|Summe_Bereich"], "Adds the numbers whose cells meet a condition (or the matching cells of another range).", "Addiert die Zahlen, deren Zellen eine Bedingung erfüllen (oder die passenden Zellen eines anderen Bereichs).", "=SUMIF(A1:A10, \"Berlin\", C1:C10)", "=SUMMEWENN(A1:A10; \"Berlin\"; C1:C10)"),
    ("PRODUCT", "PRODUKT", "math", &["number1|Zahl1", "?number2|Zahl2…"], "Multiplies the numbers.", "Multipliziert die Zahlen.", "=PRODUCT(B1, C1)", "=PRODUKT(B1; C1)"),
    ("ROUND", "RUNDEN", "math", &["number|Zahl", "?digits|Anzahl_Stellen"], "Rounds to the given number of decimal places.", "Rundet auf die angegebene Anzahl Nachkommastellen.", "=ROUND(B1, 2)", "=RUNDEN(B1; 2)"),
    ("ROUNDUP", "AUFRUNDEN", "math", &["number|Zahl", "?digits|Anzahl_Stellen"], "Rounds away from zero.", "Rundet von null weg (auf).", "=ROUNDUP(B1, 0)", "=AUFRUNDEN(B1; 0)"),
    ("ROUNDDOWN", "ABRUNDEN", "math", &["number|Zahl", "?digits|Anzahl_Stellen"], "Rounds toward zero.", "Rundet zu null hin (ab).", "=ROUNDDOWN(B1, 0)", "=ABRUNDEN(B1; 0)"),
    ("INT", "GANZZAHL", "math", &["number|Zahl"], "Rounds down to the next whole number.", "Rundet auf die nächstkleinere ganze Zahl ab.", "=INT(B1)", "=GANZZAHL(B1)"),
    ("ABS", "ABS", "math", &["number|Zahl"], "Absolute value (without sign).", "Betrag (ohne Vorzeichen).", "=ABS(B1)", "=ABS(B1)"),
    ("SQRT", "WURZEL", "math", &["number|Zahl"], "Square root.", "Quadratwurzel.", "=SQRT(B1)", "=WURZEL(B1)"),
    ("POWER", "POTENZ", "math", &["number|Zahl", "power|Potenz"], "A number raised to a power (same as ^).", "Zahl hoch Potenz (wie ^).", "=POWER(2, 10)", "=POTENZ(2; 10)"),
    ("MOD", "REST", "math", &["number|Zahl", "divisor|Divisor"], "Remainder of a division.", "Rest einer Division.", "=MOD(B1, 7)", "=REST(B1; 7)"),
    ("PI", "PI", "math", &[], "The number π (3.14159…).", "Die Zahl π (3,14159…).", "=PI()*B1^2", "=PI()*B1^2"),
    ("IF", "WENN", "logic", &["test|Prüfung", "?value_if_true|Dann_Wert", "?value_if_false|Sonst_Wert"], "One value if a condition is true, another if it is false.", "Ein Wert, wenn eine Bedingung wahr ist, ein anderer, wenn sie falsch ist.", "=IF(C1>100, \"high\", \"low\")", "=WENN(C1>100; \"hoch\"; \"niedrig\")"),
    ("IFERROR", "WENNFEHLER", "logic", &["value|Wert", "value_if_error|Wert_falls_Fehler"], "The value, or a replacement if it is an error (e.g. #DIV/0!).", "Der Wert, oder ein Ersatz, wenn er ein Fehler ist (z. B. #DIV/0!).", "=IFERROR(B1/C1, 0)", "=WENNFEHLER(B1/C1; 0)"),
    ("AND", "UND", "logic", &["logical1|Wahrheitswert1", "?logical2|Wahrheitswert2…"], "TRUE if all conditions are true.", "WAHR, wenn alle Bedingungen wahr sind.", "=AND(B1>0, C1>0)", "=UND(B1>0; C1>0)"),
    ("OR", "ODER", "logic", &["logical1|Wahrheitswert1", "?logical2|Wahrheitswert2…"], "TRUE if at least one condition is true.", "WAHR, wenn mindestens eine Bedingung wahr ist.", "=OR(B1>0, C1>0)", "=ODER(B1>0; C1>0)"),
    ("NOT", "NICHT", "logic", &["logical|Wahrheitswert"], "Reverses TRUE and FALSE.", "Kehrt WAHR und FALSCH um.", "=NOT(B1>0)", "=NICHT(B1>0)"),
    ("CONCAT", "VERKETTEN", "text", &["text1|Text1", "?text2|Text2…"], "Joins texts (same as &).", "Verbindet Texte (wie &).", "=CONCAT(A1, \" \", B1)", "=VERKETTEN(A1; \" \"; B1)"),
    ("LEN", "LÄNGE", "text", &["text|Text"], "Number of characters.", "Anzahl der Zeichen.", "=LEN(A1)", "=LÄNGE(A1)"),
    ("LEFT", "LINKS", "text", &["text|Text", "?count|Anzahl_Zeichen"], "The first characters of a text.", "Die ersten Zeichen eines Textes.", "=LEFT(A1, 3)", "=LINKS(A1; 3)"),
    ("RIGHT", "RECHTS", "text", &["text|Text", "?count|Anzahl_Zeichen"], "The last characters of a text.", "Die letzten Zeichen eines Textes.", "=RIGHT(A1, 3)", "=RECHTS(A1; 3)"),
    ("UPPER", "GROSS", "text", &["text|Text"], "Text in capital letters.", "Text in Großbuchstaben.", "=UPPER(A1)", "=GROSS(A1)"),
    ("LOWER", "KLEIN", "text", &["text|Text"], "Text in small letters.", "Text in Kleinbuchstaben.", "=LOWER(A1)", "=KLEIN(A1)"),
    ("TRIM", "GLÄTTEN", "text", &["text|Text"], "Removes extra spaces.", "Entfernt überflüssige Leerzeichen.", "=TRIM(A1)", "=GLÄTTEN(A1)"),
    ("TODAY", "HEUTE", "date", &[], "Today's date.", "Das heutige Datum.", "=TODAY()-B1", "=HEUTE()-B1"),
];

pub fn all() -> Vec<Func> {
    TABLE.iter().map(|&(name, de, cat, spec, desc_en, desc_de, example_en, example_de)| Func {
        name, de, cat, args: args(spec), desc_en, desc_de, example_en, example_de,
    }).collect()
}

#[tauri::command]
pub fn formula_functions() -> Vec<Func> { all() }

#[cfg(test)]
mod tests {
    use super::*;
    use crate::formula::{alias, call, V, NAME};

    #[test]
    fn catalog_matches_engine() {
        for f in all() {
            assert_ne!(call(f.name, &[V::Num(1.0), V::Num(1.0)], 0.0), Err(NAME), "{} is not in the engine", f.name);
            assert_eq!(alias(f.de), f.name, "German name {} should mean {}", f.de, f.name);
        }
        assert_eq!(all().len(), 31);
        let a = &all()[0].args;
        assert_eq!((a[0].en, a[0].optional, a[1].de, a[1].optional, a[1].repeat), ("number1", false, "Zahl2", true, true));
    }
}
