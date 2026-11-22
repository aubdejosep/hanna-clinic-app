// The User Guide's guides (pages/UserGuidePage.jsx) and the search over them (the search box beside the bell shows
// matching guide steps as "Guides"). Screenshots: public/guide/*.webp, from a demo copy with made-up clients only.
// A guide: {id, title, icon, intro, steps: [{title, kw (search words), text, img?, alt?, key?}], tips}.
import { ClipboardList, PawPrint, ReceiptText, UserPlus } from 'lucide-react'

export const stepId = (s) => s.key || s.img

export const GUIDES = [
  {
    id: 'receipts', title: 'Receipts: Logging the Day’s Receipts', icon: ReceiptText,
    intro: 'Each day, the front desk photographs the receipts, types each one next to its photo, and types the summary from the paper slip. The owners check it against their Ledger.',
    steps: [
      { title: 'Open Receipts and pick the day', kw: 'receipts page date calendar dot staff ledger day', img: 'r1-receipts', alt: 'The Receipts page with the Upload Photos button',
        text: <>Go to <b>Finances ▸ Receipts</b>, or tap <b>Receipts</b> at the top of any page. It opens on today. For another day, tap the date: days that already have entries show a dot.</> },
      { title: 'On a phone, the same page works', kw: 'phone mobile upload camera', img: 'r0-phone', alt: 'The Receipts page on a phone', phone: true,
        text: <>You can take the photos and upload them straight from the clinic phone. Typing is easier on the computer.</> },
      { title: 'Upload the day’s photos', kw: 'upload photos pictures receipt images bulk', img: 'r2-uploaded', alt: 'Receipt rows with their photos after uploading',
        text: <>Tap <b>Upload Photos</b> and choose all of the day’s receipt photos at once. Each photo becomes a row. When it asks, tap <b>Start Typing</b>.</> },
      { title: 'Type each receipt next to its photo', kw: 'type from photos typing receipt number qr or owner pet total discount paid with gcash bank cash full receipt zoom rotate', img: 'r3-typing', alt: 'Type From Photos: the photo on the left and the form on the right',
        text: <>The photo is big on the left. Type the <b>QR</b> or <b>OR</b> number, the <b>owner</b> and the <b>pet</b>, then the items, the <b>Total Per Receipt</b>, any <b>Discounts</b>, and <b>Paid With</b> (Cash, GCash, Bank Transfer…). Tap <b>Save and Next</b> for the next photo. Use <b>Full Receipt</b>, <b>Fit Width</b>, zoom or rotate if the photo is hard to read.</> },
      { title: 'Split payments: part cash, part online', key: 'split', kw: 'split payment partly cash partly online part cash part online gcash bank half paid two methods',
        text: <>Some clients pay part in cash and part online (e.g. a ₱2,700 bill: ₱850 cash and ₱1,850 by GCash). Set <b>Paid With</b> to the <b>online method</b> (GCash, Bank Transfer…), never Cash. Then type <b>only the online part</b>: in the table, in the <b>Online</b> column (it fills in the whole total first: type over it); in Type From Photos, in <b>Paid Online (if split)</b>. The rest counts as cash, so the summary’s Less Online and Cash On Hand match the drawer. Leave it as the whole total if everything was paid online.</> },
      { title: 'Pick items from the list', kw: 'items autocomplete suggestions price services products medicines add item quantity qty times 3 x 15 not on the list new product add to product list just this once', img: 'r4-suggest', alt: 'Item suggestions with prices while typing',
        text: <>Tap <b>Add Item</b> and type two or more letters: matching services, products and medicines appear with their prices. Pick one (click, or arrows and Enter) and its <b>price of one</b> fills in. Each item has a <b>Qty</b> (1 unless you change it): for “Prednisone 3 x 15”, type <b>3</b> and price <b>15</b>, and it works out <b>₱45</b>. If the receipt says a different price, just type over it. Not on the list? Choose <b>Add to Product List</b> (type its price; it’s on the list from then on) or <b>Just This Once</b> (it’s still suggested next time, at the price you used).</> },
      { title: 'Check the table', kw: 'table edit fix cell items total mismatch thick line', img: 'r5-grid', alt: 'The receipts table with each receipt and its items',
        text: <>Every receipt is a row, with its items under it and a thick line between receipts. Click any cell to fix it: it saves when you leave the cell. A <b>≠</b> beside an amount means the items don’t add up to the total.</> },
      { title: 'Add the expenses: the summary does itself', kw: 'expenses summary total income less online cash on hand 1st first remit grooming list automatic', key: 'summary',
        text: <>Add each expense (from the paper slip) in the <b>Expenses</b> table. The <b>Summary</b> works itself out from the receipts and expenses: <b>Total Income</b>, <b>Less Expenses</b>, <b>Less Online</b>, <b>Cash On Hand</b>, and the <b>Online</b> and <b>Grooming</b> lists. Only type the <b>1st Remit</b> if one was handed over. It saves by itself (<b>✓ Saved</b>). Compare it with the paper slip: if a figure is different, a receipt above needs fixing.</> },
    ],
    tips: [
      <>A photo of the ledger page or the summary slip isn’t a receipt: tap <b>Not a Receipt</b> on it while typing.</>,
      <>Need to look something up while typing? Tap <b>Minimize</b>: your place and typing are kept. Tap the small button at the bottom to carry on.</>,
      <>Wrong photo on a row? Tap the small camera beside its photo to replace it.</>,
      <>No internet? Take the photos with the phone’s Camera app and upload them on that day once the internet is back.</>,
    ],
  },
  {
    id: 'board', title: 'Clinic Board: Checking In and Moving Pets Along', icon: ClipboardList,
    intro: 'Every visit moves left to right on the Clinic Board: Waiting, With Vet, Inpatient (if needed), Dispense, then Done Today. Here is how a pet gets in, moves along and goes home.',
    steps: [
      { title: 'The Clinic Board', kw: 'clinic board dashboard stations waiting with vet inpatient dispense done badges', img: 'c1-board', alt: 'The Clinic Board with its five stations',
        text: <>The <b>Dashboard</b> opens on the Clinic Board: one column per station. Waiting is first come, first served (emergencies on top). The orange badges, like <b>Weigh Pet</b> or <b>Add Medicines</b>, are steps still to do for that visit. Tap a card to open the visit.</> },
      { title: 'Check a pet in: tap the tag', kw: 'check in fob tag nfc reader tap arrive', img: 'c2-appointments', alt: 'The Appointments page with Tag Reader and Walk In',
        text: <>On the front-desk computer, <b>Tag Reader</b> must be on (it then says <b>Tag Reader Ready</b>). The owner taps the pet’s tag on the reader: a booked pet is checked in and appears under <b>Waiting</b>. A tag tap works on any page of the app.</> },
      { title: 'Or check in by hand', kw: 'check in manual booking arrived', img: 'c4-checkin', alt: 'A booking with the Check In button',
        text: <>No tag? Open the booking (Appointments, or Coming Up on the Dashboard) and tap <b>Check In</b>. It does the same as tapping the tag.</> },
      { title: 'Walk-ins (no booking)', kw: 'walk in walkin no booking new client', img: 'c3-walkin', alt: 'The Walk-In Check In panel',
        text: <>Tap <b>Walk In</b>, search the pet or owner, pick the pet and tap <b>Check In Now</b>. A new client? Tap <b>New Client?</b> to register them first. Tapping the tag of a pet with no booking today also offers <b>Walk In</b>.</> },
      { title: 'Call the next pet, and move it along', kw: 'call next start consultation send to dispense admit inpatient check out undo last step', img: 'c5-withvet', alt: 'Status Control with Send to Dispense, Admit as Inpatient and Check Out',
        text: <>The vet taps <b>Call Next</b> on the Clinic Board: the first waiting pet moves to <b>With Vet</b>. After the consultation, on the visit’s <b>Status Control</b>: <b>Send to Dispense</b> (medicines and the bill), <b>Admit as Inpatient</b> (the pet stays), or <b>Check Out</b> (a quick visit like grooming). Pressed the wrong step? <b>Undo Last Step</b>.</> },
      { title: 'At Dispense: take the payment', kw: 'dispense take payment pay', img: 'c6-dispense', alt: 'A visit at Dispense with Take Payment',
        text: <>When the pet reaches <b>Dispense</b>, the front desk taps <b>Take Payment</b> on its card.</> },
      { title: 'Anything else given? Then pay', kw: 'payment paid with mark as paid check out add items cash gcash card no charge', img: 'c7-payment', alt: 'The Take Payment panel',
        text: <>First add anything else given today (vitamins, take-home medicines, an extra service): search or pick from the list. Then choose <b>Paid With</b> and tap <b>Paid & Check Out</b> if they’re leaving now, or <b>Mark as Paid</b> if the owner will tap the tag on the way out.</> },
    ],
    tips: [
      <><b>Checking out with the tag:</b> a tap checks the pet out only when it’s at Dispense <b>and</b> paid. Otherwise the tap says what’s missing and nothing changes.</>,
      <>A checked-out visit is final: to correct it, add a <b>Staff Note</b> on the visit.</>,
      <><b>The owner left before being seen?</b> While the pet is still Waiting, open the visit and tap <b>Cancel</b> with a short reason. If the vet already started, take the payment as <b>No Charge</b> with a reason, then Check Out.</>,
      <>An open visit from an earlier day stays on the board until it’s checked out, so nothing is forgotten.</>,
    ],
  },
  {
    id: 'owner', title: 'Adding a New Owner', icon: UserPlus,
    intro: 'Register a new client and their pets in one go. Do it before their first visit, or when they walk in for the first time.',
    steps: [
      { title: 'Open the Masterlist', kw: 'register owner new client masterlist', img: 'o1-masterlist', alt: 'The Masterlist with the Register Owner button',
        text: <>Go to <b>Client Portal ▸ Masterlist</b> and tap <b>Register Owner</b>. (Also on the Dashboard, and as <b>New Client?</b> in the Walk In and Book Appointment panels.) First search the owner’s name or mobile at the top of the page, to be sure they aren’t on file already.</> },
      { title: 'Type the owner’s details', kw: 'owner details name mobile email reminders', img: 'o2-owner', alt: 'The Register Owner form: owner details',
        text: <><b>Full Name</b> and <b>Mobile</b> (e.g. 0917 123 4567) are needed. Add the <b>Email</b> if they have one: booking emails and reminders go there. Additional Owner, Messenger and Address are optional. Leave <b>Send appointment reminders</b> ticked unless they ask not to.</> },
      { title: 'Add their pet, then register', kw: 'add pet breed weight species register owner add another pet', img: 'o3-pet', alt: 'The pet part of the form with Add Another Pet and Register Owner',
        text: <>Under <b>Pet</b>: the <b>name</b>, <b>breed</b> (pick from the list or type it), <b>Dog</b> or <b>Cat</b>, sex, and the <b>weight</b> (doses go by weight). Birthdate is optional: an estimate is fine. More pets? Tap <b>Add Another Pet</b> (up to 5). Then tap <b>Register Owner</b>.</> },
      { title: 'Done: the owner’s page', kw: 'owner page customer number', img: 'o4-saved', alt: 'The new owner’s page with their customer number and pet',
        text: <>The owner gets a customer number (e.g. C000006) and their page opens, with their pets. From here you can book a visit from a pet’s page, or check them in with <b>Walk In</b>.</> },
      { title: 'If the mobile is already on file', kw: 'duplicate mobile number already on file register anyway same owner', img: 'o5-duplicate', alt: 'Warning that the mobile number is already on file',
        text: <>The app stops you: <b>This mobile number is already on file</b>, with the owner it belongs to. Usually it’s the same person: open them and add the pet there instead (see Adding a New Pet). Only tap <b>Register Anyway</b> if it’s really a different person sharing the number.</> },
    ],
    tips: [
      <>Not sure of the spelling? Search by the mobile number: it finds the owner whatever way the number was typed.</>,
      <>A missing breed, weight, mobile or email shows as a reminder in the bell and on the Clinic Board, so it can be filled in at the next visit.</>,
    ],
  },
  {
    id: 'pet', title: 'Adding a New Pet', icon: PawPrint,
    intro: 'For an owner who is already on file and brings a new pet.',
    steps: [
      { title: 'Open the owner', kw: 'add pet existing owner new pet', img: 'p1-owner', alt: 'An owner’s page with the Add Pet button',
        text: <>Find the owner: use the search at the top of any page (name, mobile or a pet’s name), or <b>Client Portal ▸ Masterlist</b>. On their page, under <b>Pets</b>, tap <b>Add Pet</b>.</> },
      { title: 'Type the pet’s details and save', kw: 'pet details breed weight allergies microchip add pet', img: 'p2-form', alt: 'The Add a Pet form',
        text: <><b>Pet’s Name</b>, <b>Breed</b>, <b>Dog</b> or <b>Cat</b>, sex, and <b>Weight</b> (doses go by weight). Birthdate, colour, microchip, <b>Allergies</b> (shown in orange on the pet’s page and visits) and notes are optional. Tap <b>Add Pet</b>: it’s now on the owner’s page, ready to book or check in.</> },
    ],
    tips: [
      <>Don’t register the owner again for a new pet: one owner, all their pets on one page.</>,
      <>To fix a pet’s details later, open the pet and tap <b>Edit</b>.</>,
    ],
  },
]

// Guide steps matching what was typed: every word must appear in the guide's title, the step's title or its search
// words. -> up to `max` [{guide, step, to}]
export function searchGuides(text, max = 3) {
  const words = String(text || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1)
  if (!words.length || /^\d+$/.test(words.join(''))) return []
  const out = []
  for (const g of GUIDES) {
    for (const s of g.steps) {
      const hay = `${g.title} ${s.title} ${s.kw || ''}`.toLowerCase()
      if (!words.every((w) => hay.includes(w))) continue
      const score = words.filter((w) => `${s.title} ${s.kw || ''}`.toLowerCase().includes(w)).length + (words.every((w) => s.title.toLowerCase().includes(w)) ? 3 : 0)
      out.push({ guide: g, step: s, to: `/guide?g=${g.id}&s=${stepId(s)}`, score })
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max)
}
