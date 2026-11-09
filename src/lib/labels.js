// Plain-English names for the review flags set by the importer (lib/clients.js has the same list).
export const REVIEW_LABELS = {
  no_phone: 'No phone number',
  check_phone: "Phone isn't a valid PH mobile",
  shared_phone: 'Same mobile as another owner',
  same_name: 'Same name as another owner',
  same_name_same_owner: 'Same name as another pet of this owner',
  kiosk: 'Signed up at the kiosk: check their details',
}
