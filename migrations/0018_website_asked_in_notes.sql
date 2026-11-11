-- Website bookings used to add what the owner ticked ("VACCINATION / DEWORMING", "GROOMING"…) as unpriced
-- items on the visit. They're requests, not services given: for visits not yet checked out, they move
-- into the visit notes ("Asked for: …") and come off the item list (marked removed, not erased).
UPDATE appointments SET reason = COALESCE(reason || char(10), '') || 'Asked for: ' || (
    SELECT GROUP_CONCAT(i.name, ', ') FROM appointment_items i
    WHERE i.appointment_id = appointments.id AND i.deleted_at IS NULL AND i.kind = 'custom' AND i.added_by = 'Website' AND i.name <> 'FREE CONSULTATION') || '.'
  WHERE source = 'website' AND status IN ('pending', 'accepted', 'arrived', 'started', 'inpatient', 'dispense')
    AND EXISTS (SELECT 1 FROM appointment_items i WHERE i.appointment_id = appointments.id AND i.deleted_at IS NULL
      AND i.kind = 'custom' AND i.added_by = 'Website' AND i.name <> 'FREE CONSULTATION');
UPDATE appointment_items SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), deleted_by = 'Moved to the visit notes'
  WHERE deleted_at IS NULL AND kind = 'custom' AND added_by = 'Website' AND name <> 'FREE CONSULTATION'
    AND appointment_id IN (SELECT id FROM appointments WHERE source = 'website' AND status IN ('pending', 'accepted', 'arrived', 'started', 'inpatient', 'dispense'));
