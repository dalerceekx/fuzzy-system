import { DiseaseAnimal } from '../generated/prisma/enums.js';

const { CATTLE, CALF, SHEEP, LAMB } = DiseaseAnimal;

export interface DiseaseAnimalsEntry {
  animals: readonly DiseaseAnimal[];
  /**
   * The source phrases the animals were read from (verbatim; a unit test
   * checks each one occurs in that disease's text).
   */
  evidence: readonly string[];
}

/**
 * Animals of each disease of the 'kasalliklar-v1' source, by number. Written
 * by hand from the text — never parsed — so a wording change can never
 * silently change who a disease applies to.
 */
export const DISEASE_ANIMALS_V1: Readonly<Record<number, DiseaseAnimalsEntry>> =
  Object.freeze({
    // "Qoramollarda teridagi g'adir-budur tugunli toshma kasalligi"
    1: { animals: [CATTLE], evidence: ['Qoramollarda'] },
    // "Sigirlarda yelinning yashirin shamollashi"
    2: { animals: [CATTLE], evidence: ['Sigirlarda'] },
    // "Sigir va sovliqlarda yelinning shishib…"
    3: { animals: [CATTLE, SHEEP], evidence: ['Sigir va sovliqlarda'] },
    // "Sigir yoki sovliq tug'qanidan keyin…"
    4: { animals: [CATTLE, SHEEP], evidence: ['Sigir yoki sovliq'] },
    // "Sigirlarda eski (surunkali) bachadon shamollashi"
    5: { animals: [CATTLE], evidence: ['Sigirlarda'] },
    // "Sigir va sovliqlarning kuyga kelmasligi…"
    6: { animals: [CATTLE, SHEEP], evidence: ['Sigir va sovliqlarning'] },
    // "…sigir va sovliqlarning oyoqqa tura olmay yotib qolishi"
    7: { animals: [CATTLE, SHEEP], evidence: ['sigir va sovliqlarning'] },
    // "Buzoq, qoramol va qo'y-qo'zilarda tumov, yo'tal…"
    8: {
      animals: [CATTLE, CALF, SHEEP, LAMB],
      evidence: ["Buzoq, qoramol va qo'y-qo'zilarda"],
    },
    // "Buzoq va qo'zilarda kuchli ich ketishi"
    9: { animals: [CALF, LAMB], evidence: ["Buzoq va qo'zilarda"] },
    // "Qoramol va qo'ylarda tuyoq kasalliklari"
    10: { animals: [CATTLE, SHEEP], evidence: ["Qoramol va qo'ylarda"] },
    // "Qoramol va qo'ylarda ko'z yoshlanishi…"; "…buzoqqa 2–3 ml…"
    11: {
      animals: [CATTLE, CALF, SHEEP],
      evidence: ["Qoramol va qo'ylarda", 'buzoqqa 2–3 ml'],
    },
    // "…qoramol va qo'ylarga m/i 1 marta"
    12: { animals: [CATTLE, SHEEP], evidence: ["qoramol va qo'ylarga"] },
    // "Jigar qurti — qoramol va qo'ylarning ozib…"
    13: { animals: [CATTLE, SHEEP], evidence: ["qoramol va qo'ylarning"] },
    // "Buzoq va qo'zilarning axlatida…"; "(qoramolga 0,75 ml / 10 kg, qo'yga…"
    14: {
      animals: [CATTLE, CALF, SHEEP, LAMB],
      evidence: ["Buzoq va qo'zilarning", "qoramolga 0,75 ml / 10 kg, qo'yga"],
    },
    // "Qoramol va qo'ylarda qo'tir (qichima kana)…"
    15: { animals: [CATTLE, SHEEP], evidence: ["Qoramol va qo'ylarda"] },
    // "Buzoq va qo'zilarda oyoqqa tura olmaslik…"
    16: { animals: [CALF, LAMB], evidence: ["Buzoq va qo'zilarda"] },
    // "Qoramol, buzoq yoki qo'yning tizza va bo'g'imlari…"
    17: {
      animals: [CATTLE, CALF, SHEEP],
      evidence: ["Qoramol, buzoq yoki qo'yning"],
    },
    // "Qo'ylarni yil davomida…"; "…qo'ziga Butofan (1,5–2,5 ml)…"
    18: {
      animals: [SHEEP, LAMB],
      evidence: ["Qo'ylarni yil davomida", "qo'ziga Butofan"],
    },
  });
