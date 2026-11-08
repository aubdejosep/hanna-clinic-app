// Standard breed names for the importer (and, later, the breed picker on the pet form).
// Keys are the old system's text folded to lowercase letters only ("Shih-Tzu " -> "shihtzu"),
// so every spelling variant that folds the same way lands on one name. null = not a breed.

export const BREED_MAP = {
  // Mixed / native
  mix: 'Mixed breed', mixe: 'Mixed breed', mixed: 'Mixed breed', mixbreed: 'Mixed breed',
  mixedbreed: 'Mixed breed', mongrel: 'Mixed breed',
  aspin: 'Aspin', asapin: 'Aspin',
  puspin: 'Puspin',
  domestic: 'Domestic Shorthair', domesticcat: 'Domestic Shorthair', domesticshorthair: 'Domestic Shorthair',
  // Dogs
  shihtzu: 'Shih Tzu', shitzu: 'Shih Tzu', shitszu: 'Shih Tzu', shihztu: 'Shih Tzu', shihtsu: 'Shih Tzu',
  shitsu: 'Shih Tzu', shihtzhu: 'Shih Tzu', shizu: 'Shih Tzu',
  pomeranian: 'Pomeranian', pom: 'Pomeranian', pomspitz: 'Pomeranian',
  poodle: 'Poodle', toypoodle: 'Toy Poodle', standardpoodle: 'Standard Poodle', giantpoodle: 'Standard Poodle',
  chihuahua: 'Chihuahua', chi: 'Chihuahua', chuhuahua: 'Chihuahua', chihuahuah: 'Chihuahua',
  beagle: 'Beagle', maltese: 'Maltese', maltes: 'Maltese',
  dachshund: 'Dachshund', dacshund: 'Dachshund', duchshund: 'Dachshund', ducshund: 'Dachshund',
  daschund: 'Dachshund', dachsund: 'Dachshund', dashchund: 'Dachshund', minidaschund: 'Miniature Dachshund',
  americanbully: 'American Bully', ambull: 'American Bully', ambully: 'American Bully', bully: 'American Bully',
  americanbulldog: 'American Bulldog',
  husky: 'Siberian Husky', siberianhusky: 'Siberian Husky',
  frenchbulldog: 'French Bulldog', frenchbully: 'French Bulldog',
  englishbulldog: 'English Bulldog',
  goldenretriever: 'Golden Retriever', goldenretriver: 'Golden Retriever', golden: 'Golden Retriever', gr: 'Golden Retriever',
  corgi: 'Corgi', pembrokewelshcorgi: 'Corgi',
  chowchow: 'Chow Chow', pug: 'Pug', labrador: 'Labrador Retriever', pekingese: 'Pekingese',
  jackrussel: 'Jack Russell Terrier', jackrussell: 'Jack Russell Terrier', jackrassell: 'Jack Russell Terrier',
  jackrusselterrier: 'Jack Russell Terrier', jrt: 'Jack Russell Terrier',
  yorkie: 'Yorkshire Terrier', yorky: 'Yorkshire Terrier', yorkshire: 'Yorkshire Terrier', yorkshireterrier: 'Yorkshire Terrier',
  lhasaapso: 'Lhasa Apso', minischnauzer: 'Miniature Schnauzer',
  belgianmalinois: 'Belgian Malinois', belgianmallinois: 'Belgian Malinois', belgian: 'Belgian Malinois',
  minipincher: 'Miniature Pinscher', minipin: 'Miniature Pinscher',
  japanesespitz: 'Japanese Spitz', spitz: 'Japanese Spitz', shibainu: 'Shiba Inu',
  havanese: 'Havanese', bichon: 'Bichon Frise', bischon: 'Bichon Frise', bichonfrise: 'Bichon Frise',
  samoyed: 'Samoyed', rottweiler: 'Rottweiler', rotti: 'Rottweiler', cockerspaniel: 'Cocker Spaniel',
  gsd: 'German Shepherd', germanshepherd: 'German Shepherd', germanshepered: 'German Shepherd',
  doberman: 'Doberman', canecorso: 'Cane Corso', bassethound: 'Basset Hound', alaskanmalamute: 'Alaskan Malamute',
  terrier: 'Terrier',
  shihpoo: 'Shih-Poo', shipoo: 'Shih-Poo', shipo: 'Shih-Poo', shihtzupoodle: 'Shih-Poo', shihtzuxpoodle: 'Shih-Poo',
  maltipoo: 'Maltipoo', maltipo: 'Maltipoo', maltipom: 'Maltipom', malshi: 'Mal-Shi', shihtzumaltese: 'Mal-Shi',
  pomshi: 'Pom-Shi', pomxshi: 'Pom-Shi', shihtzupomeranian: 'Pom-Shi', goldenpoodle: 'Goldendoodle',
  // Cats
  persian: 'Persian', siamese: 'Siamese', himalayan: 'Himalayan', himalaya: 'Himalayan',
  britishshorthair: 'British Shorthair', bsh: 'British Shorthair', british: 'British Shorthair',
  britishlonghair: 'British Longhair', exoticshorthair: 'Exotic Shorthair', exotic: 'Exotic Shorthair',
  munchkin: 'Munchkin', scottishfold: 'Scottish Fold', ragdoll: 'Ragdoll', siberiancat: 'Siberian',
  sphynx: 'Sphynx', sphinx: 'Sphynx', mainecoon: 'Maine Coon',
  persiansiamese: 'Persian × Siamese', persianxsiamese: 'Persian × Siamese',
  persianhimalayan: 'Persian × Himalayan', puspinpersian: 'Puspin × Persian', persianpuspin: 'Puspin × Persian',
  mixpersian: 'Puspin × Persian',
  // Not breeds
  none: null, n: null, na: null, female: null, male: null, unknown: null, tabby: null,
}

export function foldBreed(raw) {
  return String(raw || '').toLowerCase().replace(/[^a-z]/g, '')
}

function titleCase(text) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim().replace(/(^|[\s/(-])([a-z])/g, (m, a, b) => a + b.toUpperCase())
}

// -> { breed, changed }. Unknown breeds keep the owner's words, tidied to Title Case.
export function standardBreed(raw) {
  const text = String(raw || '').trim()
  const key = foldBreed(text)
  if (!key) return { breed: null, changed: Boolean(text) }
  if (key in BREED_MAP) return { breed: BREED_MAP[key], changed: BREED_MAP[key] !== text }
  const tidy = titleCase(text)
  return { breed: tidy, changed: tidy !== text }
}
