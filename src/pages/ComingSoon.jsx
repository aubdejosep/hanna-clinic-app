import { Link } from 'react-router-dom'
import { Building2, CalendarDays, FileHeart, Inbox, MapPin, Stethoscope } from 'lucide-react'
import { Empty, PageHead } from '../components/ui.jsx'

const MODULES = {
  appointments: {
    icon: CalendarDays, title: <>Appointments</>, phase: 'Phase 2',
    text: 'Table and calendar views, booking, walk-ins, NFC tag check-in and the appointment page with status steps.',
  },
  records: {
    icon: FileHeart, title: <>Medical records</>, phase: 'Phase 3',
    text: 'Notes, diagnoses, vaccinations, treatment plans, consent forms and prescriptions, plus templates and PDF export. Old records arrive with the scraped export.',
  },
  clinic: {
    icon: Building2, title: <>Clinic profile</>, phase: 'Phase 1',
    text: 'Business details, opening hours with breaks, social media links and the kiosk QR sign-up.',
  },
  services: {
    icon: Stethoscope, title: <>Services</>, phase: 'Phase 1',
    text: 'The services price list with categories and variations, entered from the old system.',
  },
  inbox: {
    icon: Inbox, title: <>Inbox</>, phase: 'Phase 7',
    text: 'Mail to hello@hannapetwellnesscenter.com, read and answered from here, while copies still go to the current mailbox.',
  },
  missing: {
    icon: MapPin, title: <>Page not found</>, phase: null,
    text: "This address doesn't match a page in the clinic app.",
  },
}

export default function ComingSoon({ module }) {
  const m = MODULES[module]
  return (
    <>
      <PageHead title={m.title} />
      <div className="card placeholder">
        <Empty icon={m.icon} title={m.phase ? `Coming in ${m.phase.toLowerCase()}` : 'Nothing here'} text={m.text}>
          <Link className="btn btn-quiet" to="/clients">Open clients &amp; pets</Link>
        </Empty>
      </div>
    </>
  )
}
