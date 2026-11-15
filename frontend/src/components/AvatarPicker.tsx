import React, { useRef } from 'react';
import { Avatar, Button, HStack, Text, VStack, useToast } from '@chakra-ui/react';

// Profile photo picker. Crops the chosen image to a centred square, shrinks it to 256x256 and
// compresses it to a JPEG small enough for the server (~65 KB). It hands back a data URL, or null
// when the photo is removed. Nothing is uploaded until the parent saves the profile.
const SIZE = 256;
const MAX_CHARS = 85000; // the server accepts up to 90,000

function toSquareJpeg(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = SIZE; canvas.height = SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('This browser cannot process images.'));
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, SIZE, SIZE); // PNG/WebP transparency -> white
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
      for (const q of [0.85, 0.75, 0.65, 0.55, 0.45]) {
        const out = canvas.toDataURL('image/jpeg', q);
        if (out.length <= MAX_CHARS) return resolve(out);
      }
      reject(new Error('That photo is too detailed to shrink. Try a different one.'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a readable image.')); };
    img.src = url;
  });
}

export default function AvatarPicker({ name, value, onChange }: {
  name: string;
  value: string;                      // current photo (data URL) or ''
  onChange: (dataUrl: string | null) => void;   // null = remove
}) {
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const pick = async (file?: File) => {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      toast({ title: 'Use a JPEG, PNG or WebP photo', status: 'warning' });
      return;
    }
    try { onChange(await toSquareJpeg(file)); }
    catch (e: any) { toast({ title: 'Could not use that photo', description: e.message, status: 'error' }); }
  };

  return (
    <HStack spacing={5} align="center">
      <Avatar size="2xl" name={name} src={value || undefined} />
      <VStack align="start" spacing={2}>
        <HStack>
          <Button size="sm" colorScheme="blue" onClick={() => input.current?.click()}>{value ? 'Change photo' : 'Upload photo'}</Button>
          {value && <Button size="sm" variant="outline" onClick={() => onChange(null)}>Remove</Button>}
        </HStack>
        <Text fontSize="xs" opacity={0.7}>JPEG, PNG or WebP. Cropped to a square automatically.</Text>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden
          onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      </VStack>
    </HStack>
  );
}
