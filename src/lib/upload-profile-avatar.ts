import type { SupabaseClient } from "@supabase/supabase-js";
import { validateImageFile } from "@/lib/image-upload-validation";

/** Upload to `avatars` bucket at `{userId}/avatar.{ext}` with upsert. */
export async function uploadProfileAvatar(
  supabase: SupabaseClient,
  userId: string,
  file: File,
): Promise<{ publicUrl: string } | { error: string }> {
  const checked = validateImageFile(file);
  if (!checked.ok) {
    return { error: checked.error };
  }
  const rawExt = file.name.split(".").pop();
  const fileExt =
    rawExt && /^[a-z0-9]+$/i.test(rawExt) && rawExt.length <= 8 ? rawExt.toLowerCase() : "jpg";
  const filePath = `${userId}/avatar.${fileExt}`;

  const { error: uploadError } = await supabase.storage.from("avatars").upload(filePath, file, {
    contentType: file.type || `image/${fileExt}`,
    upsert: true,
  });

  if (uploadError) {
    return { error: uploadError.message || "Avatar upload failed." };
  }

  const { data } = supabase.storage.from("avatars").getPublicUrl(filePath);
  return { publicUrl: data.publicUrl };
}
