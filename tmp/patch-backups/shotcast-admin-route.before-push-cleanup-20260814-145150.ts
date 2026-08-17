import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  importShotCastManifest,
} from "@/lib/shotcast/importShotCastManifest";

import {
  requireAdminApi,
} from "@/lib/requireAdminApi";

import {
  supabaseAdmin,
} from "@/lib/supabaseAdmin";

import {
  upsertGolfCourseHoles,
} from "@/lib/golf/upsertGolfCourseHoles";

function parseSlateId(value: unknown) {
  const slateId = Number(value);

  return Number.isInteger(slateId) &&
    slateId > 0
    ? slateId
    : null;
}

export async function GET(
  request: NextRequest,
) {
  const authError =
    await requireAdminApi();

  if (authError) {
    return authError;
  }

  const slateId =
    parseSlateId(
      request.nextUrl.searchParams.get(
        "slateId",
      ),
    );

  if (!slateId) {
    return NextResponse.json(
      {
        error:
          "A valid slateId is required.",
      },
      { status: 400 },
    );
  }

  const {
    data,
    error,
  } = await supabaseAdmin
    .from("shotcast_manifests")
    .select(
      "tournament_id, manifest, generated_at, updated_at",
    )
    .eq("slate_id", slateId)
    .order(
      "updated_at",
      {
        ascending: false,
      },
    )
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    shotcast: data
      ? {
          tournamentId:
            data.tournament_id,
          generatedAt:
            data.generated_at,
          updatedAt:
            data.updated_at,
          summary:
            (data.manifest as any)
              ?.summary ?? null,
          course:
            (data.manifest as any)
              ?.course ?? null,
        }
      : null,
  });
}

export async function POST(
  request: NextRequest,
) {
  const authError =
    await requireAdminApi();

  if (authError) {
    return authError;
  }

  try {
    const body = await request.json();

    const slateId =
      parseSlateId(body?.slateId);

    const tournamentId =
      String(
        body?.tournamentId ?? "",
      )
        .trim()
        .toUpperCase();

    const round =
      Number(body?.round ?? 1);

    if (!slateId) {
      return NextResponse.json(
        {
          error:
            "A valid slateId is required.",
        },
        { status: 400 },
      );
    }

    if (
      !/^R\d{7}$/.test(
        tournamentId,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Enter a PGA tournament ID such as R2026013.",
        },
        { status: 400 },
      );
    }

    const {
      data: slate,
      error: slateError,
    } = await supabaseAdmin
      .from("slates")
      .select(
        "id, sport, display_name",
      )
      .eq("id", slateId)
      .single();

    if (
      slateError ||
      !slate
    ) {
      return NextResponse.json(
        {
          error:
            slateError?.message ||
            "Slate not found.",
        },
        { status: 404 },
      );
    }

    if (slate.sport !== "golf") {
      return NextResponse.json(
        {
          error:
            "ShotCast is only available for Golf slates.",
        },
        { status: 400 },
      );
    }

    const manifest =
      await importShotCastManifest({
        tournamentId,
        round,
      });

    console.log(
      "[PGA MANIFEST BEFORE SAVE]",
      {
        hole9:
          manifest.holes.find(
            (hole: any) =>
              Number(hole?.holeNumber) === 9,
          )?.pinWorldByRound ?? null,
        hole16:
          manifest.holes.find(
            (hole: any) =>
              Number(hole?.holeNumber) === 16,
          )?.pinWorldByRound ?? null,
      },
    );

    /*
     * ShotCast already carries the official PGA host-course
     * scorecard. Keep golf_course_holes synchronized whenever
     * ShotCast is rebuilt so course metadata can self-heal.
     */
    const manifestCourseId =
      String(
        manifest.course?.id ??
          "",
      ).trim();

    const manifestHoles =
      Array.isArray(
        manifest.holes,
      )
        ? manifest.holes
            .filter(
              (hole: any) =>
                Number.isInteger(
                  Number(
                    hole?.holeNumber,
                  ),
                ) &&
                Number.isInteger(
                  Number(
                    hole?.par,
                  ),
                ),
            )
            .map(
              (hole: any) => ({
                holeNumber:
                  Number(
                    hole.holeNumber,
                  ),
                par:
                  Number(
                    hole.par,
                  ),
                yards:
                  hole.yards ===
                    null ||
                  hole.yards ===
                    undefined
                    ? null
                    : Number(
                        hole.yards,
                      ),
              }),
            )
        : [];

    const courseSync =
      await upsertGolfCourseHoles({
        slateId,
        metadata: {
          courseId:
            manifestCourseId,
          courseName:
            typeof manifest
              .course?.name ===
              "string"
              ? manifest
                  .course
                  .name
              : null,
          isHost:
            manifest.course
              ?.hostCourse ===
            true,
          holes:
            manifestHoles,
        },
      });

    const timestamp =
      new Date().toISOString();

    const {
      error: upsertError,
    } = await supabaseAdmin
      .from("shotcast_manifests")
      .upsert(
        {
          tournament_id:
            tournamentId,
          slate_id: slateId,
          manifest,
          generated_at:
            manifest.generatedAt,
          updated_at: timestamp,
        },
        {
          onConflict:
            "tournament_id",
        },
      );

    if (!upsertError) {
      const {
        data: savedManifestRow,
        error: savedManifestReadError,
      } = await supabaseAdmin
        .from("shotcast_manifests")
        .select("manifest")
        .eq(
          "tournament_id",
          tournamentId,
        )
        .maybeSingle();

      console.log(
        "[PGA MANIFEST AFTER SAVE]",
        {
          readError:
            savedManifestReadError?.message ??
            null,
          hole9:
            (savedManifestRow?.manifest as any)
              ?.holes?.find(
                (hole: any) =>
                  Number(
                    hole?.holeNumber,
                  ) === 9,
              )?.pinWorldByRound ??
            null,
          hole16:
            (savedManifestRow?.manifest as any)
              ?.holes?.find(
                (hole: any) =>
                  Number(
                    hole?.holeNumber,
                  ) === 16,
              )?.pinWorldByRound ??
            null,
        },
      );
    }

    if (upsertError) {
      return NextResponse.json(
        {
          error:
            "ShotCast was imported but could not be saved: " +
            upsertError.message,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      tournamentId,
      course:
        manifest.course,
      summary:
        manifest.summary,
      courseHolesUpserted:
        courseSync.holesUpserted,
      generatedAt:
        manifest.generatedAt,
    });
  } catch (error) {
    console.error(
      "Admin ShotCast refresh failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected ShotCast import error.",
      },
      { status: 500 },
    );
  }
}
