export type GroupInvitationEmailDelivery =
  | {
      status: "sent";
    }
  | {
      status: "not_configured";
    }
  | {
      status: "failed";
    };


function escapeHtml(
  value: string,
) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}


export async function sendGroupInvitationEmail(
  input: {
    to: string;
    groupName: string;
    inviteUrl: string;
    expiresAt: string;
  },
): Promise<GroupInvitationEmailDelivery> {
  const apiKey =
    process.env.RESEND_API_KEY?.trim();

  const from =
    process.env.RESEND_FROM_EMAIL?.trim();

  if (
    !apiKey ||
    !from
  ) {
    return {
      status: "not_configured",
    };
  }

  const groupName =
    escapeHtml(
      input.groupName,
    );

  const inviteUrl =
    escapeHtml(
      input.inviteUrl,
    );

  try {
    const response =
      await fetch(
        "https://api.resend.com/emails",
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${apiKey}`,

            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            from,

            to: [
              input.to,
            ],

            subject:
              `You’re invited to join ${input.groupName} on 111 Sports`,

            text:
              `You’re invited to join ${input.groupName} on 111 Sports.\n\nOpen your invitation: ${input.inviteUrl}\n\nThis invitation expires ${input.expiresAt}.`,

            html:
              `<p>You’re invited to join <strong>${groupName}</strong> on 111 Sports.</p><p><a href="${inviteUrl}">Open your invitation</a></p><p>This invitation expires ${escapeHtml(input.expiresAt)}.</p>`,
          }),
        },
      );

    if (!response.ok) {
      console.error(
        "Group invitation email delivery failed",
        {
          status: response.status,
        },
      );

      return {
        status: "failed",
      };
    }

    return {
      status: "sent",
    };
  } catch (
    error
  ) {
    console.error(
      "Group invitation email delivery request failed",
      error,
    );

    return {
      status: "failed",
    };
  }
}
