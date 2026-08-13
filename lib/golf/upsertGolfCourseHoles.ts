import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type CourseHoleMetadata = {
  holeNumber: number;
  par: number;
  yards: number | null;
};

export type CourseMetadata = {
  courseId: string;
  courseName: string | null;
  isHost: boolean;
  holes: CourseHoleMetadata[];
};

function normalizeCourseMetadata(
  metadata: CourseMetadata,
): CourseMetadata {
  const courseId =
    String(metadata.courseId ?? "").trim();

  if (!courseId) {
    throw new Error(
      "Course metadata is missing a course ID.",
    );
  }

  const byHole =
    new Map<number, CourseHoleMetadata>();

  for (const rawHole of metadata.holes ?? []) {
    const holeNumber =
      Number(rawHole.holeNumber);

    const par =
      Number(rawHole.par);

    const rawYards =
      rawHole.yards === null ||
      rawHole.yards === undefined
        ? null
        : Number(rawHole.yards);

    if (
      !Number.isInteger(holeNumber) ||
      holeNumber < 1 ||
      holeNumber > 18
    ) {
      continue;
    }

    if (
      !Number.isInteger(par) ||
      par < 2 ||
      par > 7
    ) {
      continue;
    }

    const yards =
      rawYards !== null &&
      Number.isFinite(rawYards) &&
      rawYards > 0
        ? rawYards
        : null;

    byHole.set(
      holeNumber,
      {
        holeNumber,
        par,
        yards,
      },
    );
  }

  const holes =
    Array.from(byHole.values())
      .sort(
        (a, b) =>
          a.holeNumber - b.holeNumber,
      );

  /*
   * Course par is pre-tournament metadata.
   *
   * Do not silently save a partial course. If PGA does not
   * return all 18 valid pars, tournament setup should tell us
   * that instead of letting the scorecard fail on Thursday.
   */
  if (holes.length !== 18) {
    throw new Error(
      `PGA course metadata returned ${holes.length}/18 valid holes.`,
    );
  }

  return {
    courseId,
    courseName:
      metadata.courseName?.trim() ||
      null,
    isHost:
      Boolean(metadata.isHost),
    holes,
  };
}

export async function upsertGolfCourseHoles(
  input: {
    slateId: number;
    metadata: CourseMetadata;
  },
) {
  const slateId =
    Number(input.slateId);

  if (
    !Number.isInteger(slateId) ||
    slateId <= 0
  ) {
    throw new Error(
      "A valid slate ID is required to save Golf course metadata.",
    );
  }

  const metadata =
    normalizeCourseMetadata(
      input.metadata,
    );

  const timestamp =
    new Date().toISOString();

  const rows =
    metadata.holes.map(
      (hole) => ({
        slate_id: slateId,
        course_id:
          metadata.courseId,
        course_name:
          metadata.courseName,
        is_host:
          metadata.isHost,
        hole_number:
          hole.holeNumber,
        par:
          hole.par,
        yards:
          hole.yards,
        updated_at:
          timestamp,
      }),
    );

  /*
   * The selected tournament has one authoritative host-course
   * scorecard for this slate. Replace any stale/partial rows
   * only AFTER we have validated all 18 incoming holes.
   */
  const {
    error: deleteError,
  } = await supabaseAdmin
    .from("golf_course_holes")
    .delete()
    .eq("slate_id", slateId);

  if (deleteError) {
    throw new Error(
      "Existing Golf course metadata could not be replaced: " +
        deleteError.message,
    );
  }

  const {
    error: upsertError,
  } = await supabaseAdmin
    .from("golf_course_holes")
    .upsert(
      rows,
      {
        onConflict:
          "slate_id,course_id,hole_number",
      },
    );

  if (upsertError) {
    throw new Error(
      "Golf course metadata could not be saved: " +
        upsertError.message,
    );
  }

  return {
    courseId:
      metadata.courseId,
    courseName:
      metadata.courseName,
    holesUpserted:
      rows.length,
    updatedAt:
      timestamp,
  };
}
